-- Subtitle provider API keys, managed from the admin page (Subtitles). A provider can have several keys:
-- they are used in order, the next one when a key is refused or over its limit.
-- Which providers are on (and their order) is kept in settings, key 'subtitle_providers' (JSON).
CREATE TABLE IF NOT EXISTS subtitle_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,               -- subdl | subsource | opensubtitles | wyzie | jimaku (see src/subtitles/)
  label TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  ord INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  test_ok INTEGER,
  test_note TEXT NOT NULL DEFAULT '',
  tested INTEGER,
  used INTEGER NOT NULL DEFAULT 0,      -- searches + downloads through this Worker (approximate)
  last_used INTEGER,
  created INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS subtitle_keys_provider ON subtitle_keys(provider, enabled, ord);
