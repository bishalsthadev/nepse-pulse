/**
 * Cloudflare Worker entry point.
 * Handles:
 *   - scheduled() → cron monitoring every 2 min during market hours
 *   - fetch()      → HTTP routes (REST API + Telegram webhook)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './auth.js';
import watchlist from './watchlist.js';
import stocks from './stocks.js';
import alerts from './alerts.js';
import suggest from './suggest.js';
import profile from './profile.js';
import { runMonitor } from './monitor.js';
import { handleWebhook } from './telegram.js';

const app = new Hono();

// CORS — allow requests from Cloudflare Pages domain
app.use('/*', cors({
  origin: ['https://stock.bishalstha.info.np', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// API routes
app.route('/api/auth', auth);
app.route('/api/watchlist', watchlist);
app.route('/api/stocks', stocks);
app.route('/api/alerts', alerts);
app.route('/api/suggest', suggest);
app.route('/api/profile', profile);

// Telegram webhook — Telegram POSTs here when users message the bot
app.post('/telegram-webhook', async (c) => {
  const body = await c.req.json();
  await handleWebhook(body, c.env);
  return c.text('OK');
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', ts: new Date().toISOString() }));

// 404 fallback
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  // HTTP requests
  async fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },

  // Cron trigger — fires every 2 min during market hours
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runMonitor(env));
  },
};
