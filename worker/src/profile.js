/**
 * PUT /api/profile — update user profile (Telegram chat ID, etc.)
 */

import { Hono } from 'hono';
import { requireAuth } from './auth.js';

const profile = new Hono();
profile.use('/*', requireAuth);

profile.put('/', async (c) => {
  const userId = c.get('userId');
  const { telegramChatId } = await c.req.json();

  if (telegramChatId === undefined) return c.json({ error: 'telegramChatId required' }, 400);

  await c.env.DB.prepare(
    'UPDATE users SET telegram_chat_id = ? WHERE id = ?'
  ).bind(telegramChatId || null, userId).run();

  return c.json({ success: true });
});

export default profile;
