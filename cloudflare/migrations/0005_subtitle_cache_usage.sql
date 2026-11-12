-- Subtitle cache (saves provider API calls) and usage per key and hour (charts for 24 h / 7 d / 30 d in the admin).
CREATE TABLE IF NOT EXISTS subtitle_cache (
  k TEXT PRIMARY KEY,                   -- "s:<search>" (a result list, JSON) or "d:<token>" (a subtitle file, UTF-8 text)
  v TEXT NOT NULL,
  expires INTEGER NOT NULL,
  created INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS subtitle_cache_expires ON subtitle_cache(expires);

CREATE TABLE IF NOT EXISTS subtitle_usage (
  provider TEXT NOT NULL,               -- a provider id, or "cache" for answers served from the cache
  key_id INTEGER NOT NULL DEFAULT 0,    -- subtitle_keys.id, 0 = no key (keyless provider, cache)
  hour INTEGER NOT NULL,                -- Unix time / 3600
  searches INTEGER NOT NULL DEFAULT 0,
  downloads INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, key_id, hour)
);
CREATE INDEX IF NOT EXISTS subtitle_usage_hour ON subtitle_usage(hour);
