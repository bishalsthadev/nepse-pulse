/**
 * Watchlist CRUD — authenticated routes for managing a user's stock watchlist.
 */

import { Hono } from 'hono';
import { requireAuth } from './auth.js';
import { SYMBOL_LIST } from './stocks.js';

const watchlist = new Hono();
watchlist.use('/*', requireAuth);

// GET /api/watchlist — user's stocks with latest prices
watchlist.get('/', async (c) => {
  const userId = c.get('userId');
  const { results: stocks } = await c.env.DB.prepare(
    'SELECT id, symbol, holding, avg_buy_price, thresholds, active_alerts, created_at FROM user_stocks WHERE user_id = ? ORDER BY symbol'
  ).bind(userId).all();

  // Get latest prices in one query
  const symbols = stocks.map(s => s.symbol);
  let priceMap = {};
  if (symbols.length) {
    const placeholders = symbols.map(() => '?').join(',');
    const { results: priceRows } = await c.env.DB.prepare(
      `SELECT p.symbol, p.price, p.recorded_at
       FROM price_history p
       INNER JOIN (
         SELECT symbol, MAX(recorded_at) as latest FROM price_history WHERE symbol IN (${placeholders}) GROUP BY symbol
       ) m ON p.symbol = m.symbol AND p.recorded_at = m.latest`
    ).bind(...symbols).all();
    for (const r of priceRows) priceMap[r.symbol] = { price: Number(r.price), updatedAt: r.recorded_at };
  }

  const result = stocks.map(s => {
    const meta = SYMBOL_LIST.find(x => x.symbol === s.symbol);
    const thresholds = JSON.parse(s.thresholds || '{}');
    const activeAlerts = JSON.parse(s.active_alerts || '[]');
    const latest = priceMap[s.symbol] ?? null;
    let pnl = null;
    if (s.holding > 0 && s.avg_buy_price && latest) {
      pnl = {
        amount: (latest.price - s.avg_buy_price) * s.holding,
        pct: ((latest.price - s.avg_buy_price) / s.avg_buy_price) * 100,
      };
    }
    return {
      id: s.id, symbol: s.symbol,
      name: meta?.name ?? s.symbol,
      sector: meta?.sector ?? 'Unknown',
      holding: s.holding, avgBuyPrice: s.avg_buy_price,
      thresholds, activeAlerts,
      price: latest?.price ?? null,
      updatedAt: latest?.updatedAt ?? null,
      pnl,
    };
  });

  return c.json(result);
});

// POST /api/watchlist — add a stock
watchlist.post('/', async (c) => {
  const userId = c.get('userId');
  const { symbol, holding, avgBuyPrice, thresholds } = await c.req.json();

  if (!symbol) return c.json({ error: 'symbol required' }, 400);
  const sym = symbol.toUpperCase();
  if (!SYMBOL_LIST.find(s => s.symbol === sym)) return c.json({ error: `Unknown symbol: ${sym}` }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM user_stocks WHERE user_id = ? AND symbol = ?'
  ).bind(userId, sym).first();
  if (existing) return c.json({ error: 'Stock already in watchlist' }, 409);

  await c.env.DB.prepare(
    'INSERT INTO user_stocks (user_id, symbol, holding, avg_buy_price, thresholds) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, sym, holding ?? 0, avgBuyPrice ?? null, JSON.stringify(thresholds ?? {})).run();

  return c.json({ success: true });
});

// PUT /api/watchlist/:symbol — update thresholds / holding
watchlist.put('/:symbol', async (c) => {
  const userId = c.get('userId');
  const sym = c.req.param('symbol').toUpperCase();
  const { holding, avgBuyPrice, thresholds } = await c.req.json();

  const stock = await c.env.DB.prepare(
    'SELECT id FROM user_stocks WHERE user_id = ? AND symbol = ?'
  ).bind(userId, sym).first();
  if (!stock) return c.json({ error: 'Stock not in watchlist' }, 404);

  const fields = [];
  const values = [];
  if (holding !== undefined) { fields.push('holding = ?'); values.push(holding); }
  if (avgBuyPrice !== undefined) { fields.push('avg_buy_price = ?'); values.push(avgBuyPrice); }
  if (thresholds !== undefined) { fields.push('thresholds = ?'); values.push(JSON.stringify(thresholds)); }
  if (!fields.length) return c.json({ error: 'Nothing to update' }, 400);

  values.push(stock.id);
  await c.env.DB.prepare(`UPDATE user_stocks SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  return c.json({ success: true });
});

// DELETE /api/watchlist/:symbol
watchlist.delete('/:symbol', async (c) => {
  const userId = c.get('userId');
  const sym = c.req.param('symbol').toUpperCase();
  await c.env.DB.prepare(
    'DELETE FROM user_stocks WHERE user_id = ? AND symbol = ?'
  ).bind(userId, sym).run();
  return c.json({ success: true });
});

export default watchlist;
