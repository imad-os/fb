-- Stream lists on Cloudflare D1. Apply with: npx wrangler d1 migrations apply iptv --remote
CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,                 -- link name, in the users' address: /xtream/l/<id>
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  rev INTEGER NOT NULL DEFAULT 0,      -- bumped on every change (cache key)
  created INTEGER NOT NULL DEFAULT (unixepoch()),
  updated INTEGER NOT NULL DEFAULT (unixepoch())
);
INSERT OR IGNORE INTO lists (id, name) VALUES ('default', 'Default');

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,              -- plain: Xtream players send it in every address
  status TEXT NOT NULL DEFAULT 'Active',
  exp_date INTEGER,                    -- Unix seconds, NULL = no end
  max_connections INTEGER NOT NULL DEFAULT 1,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS user_lists (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, list_id)
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- = category_id for players
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- live | vod | series
  name TEXT NOT NULL,
  ord INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS categories_list ON categories(list_id, type);

CREATE TABLE IF NOT EXISTS streams (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- = stream_id / series_id for players
  list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  type TEXT NOT NULL,                   -- live | vod | series | episode
  name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',      -- the real address, never shown to players
  icon TEXT NOT NULL DEFAULT '',
  category_id INTEGER NOT NULL DEFAULT 0,
  num INTEGER NOT NULL DEFAULT 0,       -- order
  epg_id TEXT NOT NULL DEFAULT '',
  ext TEXT NOT NULL DEFAULT '',
  plot TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  rating TEXT NOT NULL DEFAULT '0',
  genre TEXT NOT NULL DEFAULT '',
  tmdb_id TEXT NOT NULL DEFAULT '',
  series_id INTEGER,                    -- episodes
  season INTEGER,
  episode INTEGER,
  added INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS streams_list ON streams(list_id, type, category_id);
CREATE INDEX IF NOT EXISTS streams_series ON streams(series_id, season, episode);
CREATE INDEX IF NOT EXISTS streams_source ON streams(list_id, source);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,              -- PBKDF2-SHA256
  salt TEXT NOT NULL,
  iter INTEGER NOT NULL,
  created INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,          -- SHA-256 of the token; the token itself is never stored
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
