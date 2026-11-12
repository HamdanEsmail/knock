-- One line per set sent to TinySet: at most fifty rows of one list.
CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  -- The numbers of the rows that were sent, as a JSON list, in the order they were written into the set.
  rows TEXT NOT NULL,
  -- claimed: the rows are taken and nothing is made yet.
  -- made:    the empty dataset exists. Nothing has been paid for.
  -- posted:  the paid fill was asked for. From here on a fill is never asked for by itself again.
  -- read:    what came back is on the rows; its sources are being read and its cost is not booked yet.
  -- booked:  its cost is in the books. The set is finished.
  -- failed:  the fill never started. Nothing was charged and the rows are free again.
  status TEXT NOT NULL,
  -- Raised by "Carry on". A run of an older attempt stops.
  attempt INTEGER NOT NULL DEFAULT 0,
  dataset_id TEXT,
  -- How many fills were asked for: 1, or 2 when the one refill was made.
  fills INTEGER NOT NULL DEFAULT 0,
  -- How many times the fill was looked at.
  looks INTEGER NOT NULL DEFAULT 0,
  -- The wallet before the fill, and when the last fill ended.
  wallet_before REAL,
  ended_at TEXT,
  booked_usd REAL,
  -- What came back, as JSON: how many rows matched, the names that were off the list or on
  -- another site, and the rows that never came.
  outcome TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX sets_list ON sets (list_id, created_at);
