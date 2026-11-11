-- Football API keys, managed from the admin page (Football API). The football helper endpoints use the keys
-- that are on, in this order, and move to the next one when a key hits its limit.
-- While this table is empty the Worker falls back to the FOOTBALL_KEYS secret.
CREATE TABLE IF NOT EXISTS football_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,                    -- e.g. https://v3.football.api-sports.io
  host TEXT NOT NULL,                   -- x-rapidapi-host header, e.g. v3.football.api-sports.io
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ord INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  test_ok INTEGER,                      -- NULL never tested, 1 ok, 0 failed
  test_note TEXT NOT NULL DEFAULT '',   -- plan, requests used today / limit, or the error
  tested INTEGER,
  used INTEGER NOT NULL DEFAULT 0,      -- calls through this Worker (approximate)
  last_used INTEGER,
  created INTEGER NOT NULL DEFAULT (unixepoch())
);
