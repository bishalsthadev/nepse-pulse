-- NEPSE Pulse — Cloudflare D1 Schema

CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  username         TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  telegram_chat_id TEXT,
  paused           INTEGER NOT NULL DEFAULT 0,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_stocks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol         TEXT NOT NULL,
  holding        INTEGER NOT NULL DEFAULT 0,
  avg_buy_price  REAL,
  thresholds     TEXT NOT NULL DEFAULT '{}',
  active_alerts  TEXT NOT NULL DEFAULT '[]',
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, symbol)
);

CREATE TABLE IF NOT EXISTS price_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol      TEXT NOT NULL,
  price       REAL NOT NULL,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS alert_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  alert_type  TEXT NOT NULL,
  price       REAL NOT NULL,
  ai_context  TEXT,
  fired_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_price_history ON price_history(symbol, recorded_at);
CREATE INDEX IF NOT EXISTS idx_alert_history ON alert_history(user_id, fired_at);
CREATE INDEX IF NOT EXISTS idx_user_stocks   ON user_stocks(user_id);
