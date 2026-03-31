/**
 * POST /api/suggest — returns Gemini-powered threshold suggestions for a symbol.
 */

import { Hono } from 'hono';
import { requireAuth } from './auth.js';
import { suggestThresholds } from './gemini.js';
import { SYMBOL_LIST } from './stocks.js';

const suggest = new Hono();
suggest.use('/*', requireAuth);

suggest.post('/', async (c) => {
  const { symbol } = await c.req.json();
  if (!symbol) return c.json({ error: 'symbol required' }, 400);

  const sym = symbol.toUpperCase();
  const meta = SYMBOL_LIST.find(s => s.symbol === sym);
  if (!meta) return c.json({ error: `Unknown symbol: ${sym}` }, 400);

  // Get latest price
  const latestRow = await c.env.DB.prepare(
    'SELECT price FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 1'
  ).bind(sym).first();

  if (!latestRow) {
    // Fall back to percentage-based suggestions if no price data yet
    return c.json({ source: 'default', thresholds: null });
  }

  const currentPrice = Number(latestRow.price);

  // Get last 30 price points for trend context
  const { results: histRows } = await c.env.DB.prepare(
    'SELECT price FROM price_history WHERE symbol = ? ORDER BY recorded_at DESC LIMIT 30'
  ).bind(sym).all();
  const recentPrices = histRows.map(r => Number(r.price)).reverse();

  if (!c.env.GEMINI_API_KEY) {
    // No Gemini key — return percentage-based fallback
    return c.json({ source: 'fallback', thresholds: percentageFallback(currentPrice) });
  }

  const thresholds = await suggestThresholds(sym, meta.name, currentPrice, recentPrices, c.env.GEMINI_API_KEY);

  if (!thresholds) {
    return c.json({ source: 'fallback', thresholds: percentageFallback(currentPrice) });
  }

  return c.json({ source: 'gemini', currentPrice, thresholds });
});

/**
 * Simple percentage-based fallback thresholds when Gemini is unavailable.
 */
function percentageFallback(price) {
  const r = (n) => Math.round(n);
  return {
    buy_zone:     [r(price * 0.95), r(price * 0.97)],
    add_zone:     [r(price * 0.92), r(price * 0.94)],
    partial_exit: [r(price * 1.08), r(price * 1.10)],
    full_exit:    [r(price * 1.15), r(price * 1.20)],
    stop_loss:    r(price * 0.88),
  };
}

export default suggest;
