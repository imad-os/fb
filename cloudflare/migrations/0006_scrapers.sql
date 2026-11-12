-- Match-site scrapers (admin page > Scrapers): sites built on the "Yalla Shoot" template (AY_Match blocks,
-- /albaplayer/<slug>/?serv=N players). A run (in the admin page) finds the match streams, checks them, and
-- replaces the site's category in the chosen list with the streams that work.
CREATE TABLE IF NOT EXISTS scrapers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,              -- e.g. https://yalla.golf/
  name TEXT NOT NULL DEFAULT '',         -- category name; empty = the domain (yalla.golf)
  tomorrow INTEGER NOT NULL DEFAULT 0,   -- also read /matches-tomorrow
  yesterday INTEGER NOT NULL DEFAULT 0,  -- also read /matches-yesterday
  enabled INTEGER NOT NULL DEFAULT 1,    -- taken by "Run all"
  note TEXT NOT NULL DEFAULT '',
  last_run INTEGER,                      -- Unix seconds
  last_list TEXT NOT NULL DEFAULT '',    -- list written by the last run
  last_cat TEXT NOT NULL DEFAULT '',     -- category name written by the last run (removed by the next run even if renamed)
  last_count INTEGER,                    -- working streams written
  last_note TEXT NOT NULL DEFAULT '',    -- e.g. "12 matches, 9 streams" or the error
  created INTEGER NOT NULL DEFAULT (unixepoch())
);
