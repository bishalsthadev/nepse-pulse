/**
 * Telegram integration.
 * - sendAlert(): push notification to a user
 * - sendMessage(): raw message to a chat
 * - handleWebhook(): respond to bot commands from users
 */

import { ALERT_META } from './analyzer.js';

const TG_API = (token) => `https://api.telegram.org/bot${token}`;

// -------------------------------------------------------------------
// Send helpers
// -------------------------------------------------------------------

export async function sendMessage(chatId, text, token) {
  await fetch(`${TG_API(token)}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

export async function sendAlert(chatId, alert, aiContext, token) {
  const meta = alert.meta;
  const lines = [
    `${meta.emoji} <b>${alert.symbol} — ${meta.label}</b>`,
    `<i>${alert.name}</i>`,
    '',
    `💰 Price: <b>${alert.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} NPR</b>`,
  ];

  if (alert.threshold) lines.push(`🎯 Zone: ${alert.threshold}`);

  if (alert.pctChange !== null && alert.pctChange !== undefined) {
    const sign = alert.pctChange > 0 ? '+' : '';
    lines.push(`⚡ Move: ${sign}${alert.pctChange.toFixed(1)}% this cycle`);
  }

  if (alert.pnl) {
    const sign = alert.pnl.amount >= 0 ? '+' : '';
    lines.push(`📊 P&amp;L: ${sign}${Math.round(alert.pnl.amount).toLocaleString('en-IN')} NPR (${alert.pnl.pct >= 0 ? '+' : ''}${alert.pnl.pct.toFixed(1)}%)`);
  }

  lines.push('', `👉 <b>${meta.action}</b>`);

  if (aiContext) lines.push('', `📡 AI: <i>${aiContext}</i>`);

  await sendMessage(chatId, lines.join('\n'), token);
}

export async function sendEarlyWarning(chatId, symbol, thresholdType, aiText, token) {
  const meta = ALERT_META[thresholdType] ?? { emoji: '⚠️' };
  const text = `${meta.emoji} <b>${symbol} — Approaching ${thresholdType.replace(/_/g, ' ').toUpperCase()}</b>\n\n📡 ${aiText}`;
  await sendMessage(chatId, text, token);
}

export async function sendDigest(chatId, stocks, token) {
  const lines = ['📊 <b>NEPSE Pulse — Daily Digest</b>', ''];

  for (const s of stocks) {
    const meta = ALERT_META[s.status] ?? ALERT_META['daily_digest'];
    let line = `${meta.emoji} <b>${s.symbol}</b> — ${s.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} NPR`;
    if (s.pnl) {
      const sign = s.pnl.amount >= 0 ? '+' : '';
      line += ` | P&amp;L: ${sign}${Math.round(s.pnl.amount).toLocaleString('en-IN')} NPR`;
    }
    lines.push(line);
  }

  lines.push('', '🔗 <a href="https://stock.bishalstha.info.np">View Dashboard</a>');
  await sendMessage(chatId, lines.join('\n'), token);
}

// -------------------------------------------------------------------
// Webhook — handle commands sent to the bot by users
// -------------------------------------------------------------------

export async function handleWebhook(body, env) {
  const message = body.message ?? body.edited_message;
  if (!message?.text) return;

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const token = env.TELEGRAM_BOT_TOKEN;

  // Match user by telegram_chat_id
  const userRow = await env.DB.prepare(
    'SELECT id, username, paused FROM users WHERE telegram_chat_id = ?'
  ).bind(chatId).first();

  if (text.startsWith('/start') || text.startsWith('/help')) {
    const intro = userRow
      ? `👋 Hi <b>${userRow.username}</b>! I'm your NEPSE Pulse bot.\n\nCommands:\n/price SYMBOL — latest price\n/portfolio — your holdings\n/alerts — last 5 alerts\n/pause — pause notifications\n/resume — resume notifications`
      : `👋 Welcome to NEPSE Pulse!\n\nTo receive notifications, register at <a href="https://stock.bishalstha.info.np">stock.bishalstha.info.np</a>, then add your Telegram Chat ID (<code>${chatId}</code>) in Settings.`;
    await sendMessage(chatId, intro, token);
    return;
  }

  // /chatid — helper so users can easily find their ID
  if (text.startsWith('/chatid')) {
    await sendMessage(chatId, `Your Telegram Chat ID is: <code>${chatId}</code>\n\nPaste this in Settings on the dashboard.`, token);
    return;
  }

  if (!userRow) {
    await sendMessage(chatId, `ℹ️ Link your Telegram account first:\n1. Register at stock.bishalstha.info.np\n2. Go to Settings → paste your Chat ID: <code>${chatId}</code>`, token);
    return;
  }

  if (text.startsWith('/price ')) {
    const symbol = text.split(' ')[1]?.toUpperCase();
    if (!symbol) { await sendMessage(chatId, 'Usage: /price NABIL', token); return; }
    const row = await env.DB.prepare(
      'SELECT price, recorded_at FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 1'
    ).bind(symbol).first();
    if (!row) {
      await sendMessage(chatId, `No price data for ${symbol}. Is it on the watchlist?`, token);
    } else {
      await sendMessage(chatId, `📈 <b>${symbol}</b>: ${Number(row.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })} NPR\n<i>${row.recorded_at} UTC</i>`, token);
    }
    return;
  }

  if (text.startsWith('/portfolio')) {
    const stocks = await env.DB.prepare(
      'SELECT symbol, holding, avg_buy_price FROM user_stocks WHERE user_id = ? AND holding > 0'
    ).bind(userRow.id).all();
    if (!stocks.results.length) {
      await sendMessage(chatId, 'You have no holdings set up yet. Visit the dashboard to add stocks.', token);
      return;
    }
    const lines = ['💼 <b>Your Portfolio</b>', ''];
    for (const s of stocks.results) {
      const latestRow = await env.DB.prepare(
        'SELECT price FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 1'
      ).bind(s.symbol).first();
      if (!latestRow) continue;
      const price = Number(latestRow.price);
      const pnl = (price - s.avg_buy_price) * s.holding;
      const pct = ((price - s.avg_buy_price) / s.avg_buy_price) * 100;
      const sign = pnl >= 0 ? '+' : '';
      lines.push(`<b>${s.symbol}</b> × ${s.holding} @ ${s.avg_buy_price} NPR\nNow: ${price.toLocaleString('en-IN', { minimumFractionDigits: 2 })} NPR | P&amp;L: ${sign}${Math.round(pnl).toLocaleString('en-IN')} NPR (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`);
    }
    await sendMessage(chatId, lines.join('\n'), token);
    return;
  }

  if (text.startsWith('/alerts')) {
    const rows = await env.DB.prepare(
      'SELECT symbol, alert_type, price, fired_at FROM alert_history WHERE user_id = ? ORDER BY fired_at DESC LIMIT 5'
    ).bind(userRow.id).all();
    if (!rows.results.length) {
      await sendMessage(chatId, 'No alerts fired yet.', token);
      return;
    }
    const lines = ['🔔 <b>Recent Alerts</b>', ''];
    for (const r of rows.results) {
      const meta = ALERT_META[r.alert_type];
      lines.push(`${meta?.emoji ?? '•'} ${r.symbol} — ${meta?.label ?? r.alert_type} @ ${Number(r.price).toLocaleString('en-IN', { minimumFractionDigits: 2 })} NPR\n<i>${r.fired_at} UTC</i>`);
    }
    await sendMessage(chatId, lines.join('\n'), token);
    return;
  }

  if (text.startsWith('/pause')) {
    await env.DB.prepare('UPDATE users SET paused = 1 WHERE id = ?').bind(userRow.id).run();
    await sendMessage(chatId, '⏸ Notifications paused. Send /resume to re-enable.', token);
    return;
  }

  if (text.startsWith('/resume')) {
    await env.DB.prepare('UPDATE users SET paused = 0 WHERE id = ?').bind(userRow.id).run();
    await sendMessage(chatId, '▶️ Notifications resumed!', token);
    return;
  }

  await sendMessage(chatId, 'Unknown command. Send /help for available commands.', token);
}
