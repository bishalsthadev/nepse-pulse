/**
 * Alert history — authenticated route to fetch a user's past alerts.
 */

import { Hono } from 'hono';
import { requireAuth } from './auth.js';

const alerts = new Hono();
alerts.use('/*', requireAuth);

// GET /api/alerts?limit=50&symbol=NABIL
alerts.get('/', async (c) => {
  const userId = c.get('userId');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const symbol = c.req.query('symbol');

  let sql = 'SELECT id, symbol, alert_type, price, ai_context, fired_at FROM alert_history WHERE user_id = ?';
  const params = [userId];
  if (symbol) { sql += ' AND symbol = ?'; params.push(symbol.toUpperCase()); }
  sql += ' ORDER BY fired_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();
  return c.json(results);
});

export default alerts;
