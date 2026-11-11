-- Stream check: a stream can be turned off (players stop seeing it) and keeps the result of its last check.
ALTER TABLE streams ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE streams ADD COLUMN check_ok INTEGER;                  -- NULL never checked, 1 up, 0 down, -1 cannot be checked
ALTER TABLE streams ADD COLUMN check_note TEXT NOT NULL DEFAULT ''; -- e.g. "200", "404", "timeout"
ALTER TABLE streams ADD COLUMN checked INTEGER;                   -- Unix seconds of the last check
