/**
 * Cron monitor — runs every 2 min during NEPSE market hours.
 * Fetches prices, checks all users' thresholds, sends Telegram alerts.
 */

import { fetchAllPrices } from './scraper.js';
import { analyzeStock, nearestApproach } from './analyzer.js';
import { earlyWarningText } from './gemini.js';
import { sendAlert, sendEarlyWarning, sendDigest } from './telegram.js';
import { SYMBOLS } from './stocks.js';

// Market hours: Sun–Thu, 05:15–09:15 UTC (11:00 AM–3:00 PM NST)
// Digest time:  09:25–09:35 UTC
function marketStatus() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const mins = h * 60 + m;

  const isTradeDay = [0, 1, 2, 3, 4].includes(day);
  const isOpen = isTradeDay && mins >= 315 && mins < 555;   // 05:15–09:15
  const isDigest = isTradeDay && mins >= 565 && mins < 575; // 09:25–09:35

  return { isOpen, isDigest };
}

export async function runMonitor(env) {
  const { isOpen, isDigest } = marketStatus();
  if (!isOpen && !isDigest) {
    console.log('[monitor] Outside market hours, skipping.');
    return;
  }

  console.log(`[monitor] Running — isOpen=${isOpen} isDigest=${isDigest}`);

  // 1. Fetch all prices
  const prices = await fetchAllPrices(SYMBOLS);
  const fetchedAt = new Date().toISOString();
  console.log('[monitor] Prices fetched:', JSON.stringify(prices));

  // 2. Write to price_history + prune old records (keep 7 days)
  const insertStmt = env.DB.prepare('INSERT INTO price_history (symbol, price) VALUES (?, ?)');
  const inserts = Object.entries(prices)
    .filter(([, p]) => p !== null)
    .map(([sym, p]) => insertStmt.bind(sym, p));

  if (inserts.length) await env.DB.batch(inserts);

  // Prune price_history older than 7 days (run async, don't wait)
  env.DB.prepare("DELETE FROM price_history WHERE recorded_at < datetime('now', '-7 days')").run();

  // 3. Load all users with Telegram enabled and not paused
  const { results: users } = await env.DB.prepare(
    'SELECT id, username, telegram_chat_id FROM users WHERE telegram_chat_id IS NOT NULL AND telegram_chat_id != "" AND paused = 0'
  ).all();

  if (!users.length) {
    console.log('[monitor] No users with Telegram configured.');
    return;
  }

  // 4. For each user
  for (const user of users) {
    try {
      await processUser(user, prices, fetchedAt, isDigest, env);
    } catch (err) {
      console.error(`[monitor] Error processing user ${user.username}:`, err);
    }
  }
}

async function processUser(user, prices, fetchedAt, isDigest, env) {
  const { results: stocks } = await env.DB.prepare(
    'SELECT id, symbol, holding, avg_buy_price, thresholds, active_alerts FROM user_stocks WHERE user_id = ?'
  ).bind(user.id).all();

  if (!stocks.length) return;

  if (isDigest) {
    await sendDailyDigest(user, stocks, prices, env);
    return;
  }

  for (const stock of stocks) {
    const price = prices[stock.symbol];
    if (price === null || price === undefined) continue;

    const thresholds = JSON.parse(stock.thresholds || '{}');
    const activeAlerts = JSON.parse(stock.active_alerts || '[]');

    // Get previous price for rapid move detection
    const prevRow = await env.DB.prepare(
      'SELECT price FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 1 OFFSET 1'
    ).bind(stock.symbol).first();
    const prevPrice = prevRow ? Number(prevRow.price) : null;

    // Analyze thresholds
    const { alerts, newActiveAlerts } = analyzeStock(
      stock.symbol, stock.symbol, price, prevPrice,
      thresholds, activeAlerts, stock.holding, stock.avg_buy_price
    );

    // Send threshold + rapid move alerts
    for (const alert of alerts) {
      let aiContext = null;
      // Only call Gemini for threshold alerts (not rapid moves) to save quota
      if (!['rapid_up', 'rapid_down'].includes(alert.type) && env.GEMINI_API_KEY) {
        const recentRows = await env.DB.prepare(
          'SELECT price FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 5'
        ).bind(stock.symbol).all();
        const recentPrices = recentRows.results.map(r => Number(r.price)).reverse();
        aiContext = await earlyWarningText(
          stock.symbol, price, alert.type,
          alert.threshold ? parseFloat(alert.threshold) : price,
          0, 'at zone', recentPrices, env.GEMINI_API_KEY
        );
      }

      await sendAlert(user.telegram_chat_id, alert, aiContext, env.TELEGRAM_BOT_TOKEN);
      await env.DB.prepare(
        'INSERT INTO alert_history (user_id, symbol, alert_type, price, ai_context) VALUES (?, ?, ?, ?, ?)'
      ).bind(user.id, stock.symbol, alert.type, price, aiContext).run();
    }

    // Update active_alerts in DB if changed
    if (JSON.stringify(newActiveAlerts.sort()) !== JSON.stringify(activeAlerts.sort())) {
      await env.DB.prepare(
        'UPDATE user_stocks SET active_alerts = ? WHERE id = ?'
      ).bind(JSON.stringify(newActiveAlerts), stock.id).run();
    }

    // Early warning: approaching a threshold (within 3%)
    const approach = nearestApproach(price, prevPrice, thresholds, newActiveAlerts);
    if (approach && approach.proximityPct < 3 && env.GEMINI_API_KEY) {
      // Only warn once per threshold approach per session (track via a warning key)
      const warningKey = `warning_${stock.symbol}_${approach.type}`;
      const alreadyWarned = newActiveAlerts.includes(warningKey);
      if (!alreadyWarned) {
        const recentRows = await env.DB.prepare(
          'SELECT price FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 5'
        ).bind(stock.symbol).all();
        const recentPrices = recentRows.results.map(r => Number(r.price)).reverse();

        const warningText = await earlyWarningText(
          stock.symbol, price, approach.type, approach.threshold,
          approach.proximityPct, approach.direction, recentPrices, env.GEMINI_API_KEY
        );
        if (warningText) {
          await sendEarlyWarning(user.telegram_chat_id, stock.symbol, approach.type, warningText, env.TELEGRAM_BOT_TOKEN);
          const updatedActive = [...newActiveAlerts, warningKey];
          await env.DB.prepare(
            'UPDATE user_stocks SET active_alerts = ? WHERE id = ?'
          ).bind(JSON.stringify(updatedActive), stock.id).run();
        }
      }
    }
  }
}

async function sendDailyDigest(user, stocks, prices, env) {
  const digestStocks = stocks.map(s => {
    const price = prices[s.symbol];
    if (!price) return null;
    let pnl = null;
    if (s.holding > 0 && s.avg_buy_price) {
      pnl = { amount: (price - s.avg_buy_price) * s.holding, pct: ((price - s.avg_buy_price) / s.avg_buy_price) * 100 };
    }
    return { symbol: s.symbol, price, status: 'daily_digest', pnl };
  }).filter(Boolean);

  if (digestStocks.length) {
    await sendDigest(user.telegram_chat_id, digestStocks, env.TELEGRAM_BOT_TOKEN);
  }
}
