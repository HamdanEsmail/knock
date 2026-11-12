-- One row per list that was handed in.
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- csv or sheet
  source TEXT NOT NULL,
  -- visitor or mine
  owner TEXT NOT NULL,
  -- The sheet's own first line as a JSON list, and which columns hold the name and the address.
  header TEXT NOT NULL,
  name_col INTEGER NOT NULL,
  address_col INTEGER,
  row_count INTEGER NOT NULL,
  -- working, waiting (for the next day's reading allowance) or done
  status TEXT NOT NULL,
  -- What is being done now, in words, for the list's page.
  note TEXT NOT NULL DEFAULT '',
  -- Raised by "Carry on". Every run's id carries it, and a run from an older attempt stops.
  attempt INTEGER NOT NULL DEFAULT 0,
  -- One character for each row, in order:
  -- . not knocked on yet, a alive, s slowing down, z zombie, u could not tell.
  wall TEXT NOT NULL,
  -- How many rows of this list may be put to TinySet.
  outside_max INTEGER NOT NULL DEFAULT 0,
  -- 1 when the list is the one shown on the first page. Only I can set it.
  featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  -- The last time a row of this list moved. "Carry on" works only when this is ten minutes old.
  moved_at TEXT NOT NULL,
  -- When a waiting list takes up its work again. Null unless it waits.
  wake_at TEXT,
  finished_at TEXT
);
CREATE INDEX lists_created ON lists (created_at);

-- One row per line of the sheet, in the sheet's order from 0.
CREATE TABLE rows (
  list_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  -- The visitor's own cells as a JSON list, untouched.
  cells TEXT NOT NULL,
  name TEXT NOT NULL,
  -- The address as Knock asks it (https://host/path), or null when none was given.
  address TEXT,
  -- Each sign is JSON, null until it has been asked. The shapes are in src/core/signs.ts.
  door TEXT,
  door_tries INTEGER NOT NULL DEFAULT 0,
  pages TEXT,
  pages_tries INTEGER NOT NULL DEFAULT 0,
  reads TEXT,
  set_id TEXT,
  outside TEXT,
  verdict TEXT,
  rule INTEGER,
  last_seen TEXT,
  last_seen_from TEXT,
  why TEXT,
  -- JSON list of links, the deciding one first.
  evidence TEXT,
  checked_on TEXT,
  PRIMARY KEY (list_id, n)
);
CREATE INDEX rows_verdict ON rows (list_id, verdict, n);

-- Counters that bound a day, an hour or a minute: pages read, searches, new lists.
CREATE TABLE limits (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name)
);

-- Every dollar booked, one line each.
CREATE TABLE spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_usd REAL NOT NULL,
  ref TEXT
);
