// Everything Knock keeps in the database. No other file writes SQL.
//
// The free plan allows one run 50 database queries, so nothing here writes a statement a row:
// many rows go in, and many rows change, with one statement that reads them from a JSON list.
import { FREE_READS_PER_DAY, GROUP_ROWS, READS_USD_MAX, READ_USD } from "../core/limits";
import type { DoorSign, OutsideSign, PagesSign, ReadItem, Verdict } from "../core/signs";
import type { Env } from "../env";

// ---- Lists ----

export type ListStatus = "working" | "waiting" | "done";

export type ListRecord = {
  id: string;
  title: string;
  source: "csv" | "sheet";
  owner: "visitor" | "mine";
  /** The first line of the sheet that goes back. */
  header: string[];
  nameCol: number;
  addressCol: number | null;
  rowCount: number;
  status: ListStatus;
  /** What is being done now, in words. */
  note: string;
  attempt: number;
  wall: string;
  outsideMax: number;
  featured: boolean;
  createdAt: string;
  movedAt: string;
  wakeAt: string | null;
  finishedAt: string | null;
};

/** One line of a sheet as it is first written. */
export type NewRow = { n: number; cells: string[]; name: string; address: string | null };

/** The door of a row that came without an address. It is set when the row is written and never asked. */
const NO_ADDRESS: DoorSign = { kind: "no_address", asked: null, finalUrl: null, toHost: null, namesIt: null, title: null, chars: 0, serverDate: null, jobsLink: null, signupLink: null, error: null, knocks: 0 };

/** Rows sent in one statement. A bound value may hold 2 MB; a sheet holds at most 600,000 characters. */
const ROWS_PER_INSERT = 250;

/** Writes a list and all its rows, in one batch of a few statements. */
export async function insertList(
  db: D1Database,
  list: { id: string; title: string; source: "csv" | "sheet"; owner: "visitor" | "mine"; header: string[]; nameCol: number; addressCol: number | null; now: string },
  rows: NewRow[],
): Promise<void> {
  const statements = [
    db
      .prepare("INSERT INTO lists (id, title, source, owner, header, name_col, address_col, row_count, status, wall, created_at, moved_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'working', ?9, ?10, ?10)")
      .bind(list.id, list.title, list.source, list.owner, JSON.stringify(list.header), list.nameCol, list.addressCol, rows.length, ".".repeat(rows.length), list.now),
  ];
  for (let from = 0; from < rows.length; from += ROWS_PER_INSERT) {
    const part = rows.slice(from, from + ROWS_PER_INSERT).map((r) => ({ n: r.n, cells: r.cells, name: r.name, address: r.address, door: r.address === null ? NO_ADDRESS : null }));
    statements.push(
      db
        .prepare(
          `INSERT INTO rows (list_id, n, cells, name, address, door)
           SELECT ?1, json_extract(value, '$.n'), json_extract(value, '$.cells'), json_extract(value, '$.name'), json_extract(value, '$.address'), json_extract(value, '$.door')
           FROM json_each(?2)`,
        )
        .bind(list.id, JSON.stringify(part)),
    );
  }
  await db.batch(statements);
}

type ListLine = {
  id: string;
  title: string;
  source: string;
  owner: string;
  header: string;
  name_col: number;
  address_col: number | null;
  row_count: number;
  status: string;
  note: string;
  attempt: number;
  wall: string;
  outside_max: number;
  featured: number;
  created_at: string;
  moved_at: string;
  wake_at: string | null;
  finished_at: string | null;
};

const parse = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));

const toList = (l: ListLine): ListRecord => ({
  id: l.id,
  title: l.title,
  source: l.source === "sheet" ? "sheet" : "csv",
  owner: l.owner === "mine" ? "mine" : "visitor",
  header: parse<string[]>(l.header) ?? [],
  nameCol: l.name_col,
  addressCol: l.address_col,
  rowCount: l.row_count,
  status: l.status === "done" ? "done" : l.status === "waiting" ? "waiting" : "working",
  note: l.note,
  attempt: l.attempt,
  wall: l.wall,
  outsideMax: l.outside_max,
  featured: l.featured === 1,
  createdAt: l.created_at,
  movedAt: l.moved_at,
  wakeAt: l.wake_at,
  finishedAt: l.finished_at,
});

export async function getList(db: D1Database, id: string): Promise<ListRecord | null> {
  const line = await db.prepare("SELECT * FROM lists WHERE id = ?").bind(id).first<ListLine>();
  return line === null ? null : toList(line);
}

/** The list shown on the first page, if I have chosen one. */
export async function featuredList(db: D1Database): Promise<ListRecord | null> {
  const line = await db.prepare("SELECT * FROM lists WHERE featured = 1 ORDER BY created_at DESC LIMIT 1").first<ListLine>();
  return line === null ? null : toList(line);
}

const LIST_COLUMNS = { status: "status", note: "note", attempt: "attempt", wakeAt: "wake_at", finishedAt: "finished_at", movedAt: "moved_at", featured: "featured", outsideMax: "outside_max" } as const;

export type ListPatch = Partial<{ status: ListStatus; note: string; attempt: number; wakeAt: string | null; finishedAt: string | null; movedAt: string; featured: number; outsideMax: number }>;

/** Changes the named fields of a list, and nothing else. */
export async function patchList(db: D1Database, id: string, patch: ListPatch): Promise<void> {
  const names = (Object.keys(patch) as (keyof ListPatch)[]).filter((k) => patch[k] !== undefined);
  if (names.length === 0) return;
  const sets = names.map((k, i) => `${LIST_COLUMNS[k]} = ?${i + 2}`).join(", ");
  await db
    .prepare(`UPDATE lists SET ${sets} WHERE id = ?1`)
    .bind(id, ...names.map((k) => patch[k] ?? null))
    .run();
}

/** Raises a list's attempt by one, if it is still the attempt the caller saw. True when it was. */
export async function raiseAttempt(db: D1Database, id: string, from: number, now: string): Promise<boolean> {
  const done = await db.prepare("UPDATE lists SET attempt = attempt + 1, moved_at = ?3, status = 'working', wake_at = NULL WHERE id = ?1 AND attempt = ?2 AND status <> 'done'").bind(id, from, now).run();
  return done.meta.changes === 1;
}

export async function deleteList(db: D1Database, id: string): Promise<void> {
  await db.batch([db.prepare("DELETE FROM rows WHERE list_id = ?").bind(id), db.prepare("DELETE FROM sets WHERE list_id = ?").bind(id), db.prepare("DELETE FROM lists WHERE id = ?").bind(id)]);
}

// ---- Rows ----

/** What a leg needs to know of a row to work on it. */
export type RowState = {
  n: number;
  name: string;
  address: string | null;
  door: DoorSign | null;
  doorTries: number;
  pages: PagesSign | null;
  pagesTries: number;
  /** The pages to read beyond the home page. Null until they have been chosen. */
  reads: ReadItem[] | null;
  outside: OutsideSign | null;
  verdict: Verdict | null;
};

type RowLine = {
  n: number;
  cells?: string;
  name: string;
  address: string | null;
  door: string | null;
  door_tries: number;
  pages: string | null;
  pages_tries: number;
  reads: string | null;
  outside: string | null;
  verdict: string | null;
  rule?: number | null;
  last_seen?: string | null;
  last_seen_from?: string | null;
  why?: string | null;
  evidence?: string | null;
  checked_on?: string | null;
};

const toState = (r: RowLine): RowState => ({
  n: r.n,
  name: r.name,
  address: r.address,
  door: parse<DoorSign>(r.door),
  doorTries: r.door_tries,
  pages: parse<PagesSign>(r.pages),
  pagesTries: r.pages_tries,
  reads: parse<ReadItem[]>(r.reads),
  outside: parse<OutsideSign>(r.outside),
  verdict: r.verdict as Verdict | null,
});

/** The rows of one group, in the sheet's order. Group 0 holds rows 0 to 39. */
export async function loadGroup(db: D1Database, listId: string, group: number): Promise<RowState[]> {
  const { results } = await db
    .prepare("SELECT n, name, address, door, door_tries, pages, pages_tries, reads, outside, verdict FROM rows WHERE list_id = ?1 AND n >= ?2 AND n < ?3 ORDER BY n")
    .bind(listId, group * GROUP_ROWS, (group + 1) * GROUP_ROWS)
    .all<RowLine>();
  return results.map(toState);
}

/** A row with everything on it: the visitor's own cells, the signs and the verdict. */
export type FullRow = RowState & { cells: string[]; rule: number | null; lastSeen: string | null; lastSeenFrom: string | null; why: string | null; evidence: string[]; checkedOn: string | null };

/** Rows from `from` on, at most `count` of them, in the sheet's order; with `verdict`, only rows with that verdict. */
export async function listRows(db: D1Database, listId: string, opts: { from: number; count: number; verdict?: Verdict }): Promise<FullRow[]> {
  const where = opts.verdict === undefined ? "" : " AND verdict = ?4";
  const statement = db.prepare(`SELECT * FROM rows WHERE list_id = ?1 AND n >= ?2${where} ORDER BY n LIMIT ?3`);
  const { results } = await (opts.verdict === undefined ? statement.bind(listId, opts.from, opts.count) : statement.bind(listId, opts.from, opts.count, opts.verdict)).all<RowLine>();
  return results.map((r) => ({
    ...toState(r),
    cells: parse<string[]>(r.cells ?? null) ?? [],
    rule: r.rule ?? null,
    lastSeen: r.last_seen ?? null,
    lastSeenFrom: r.last_seen_from ?? null,
    why: r.why ?? null,
    evidence: parse<string[]>(r.evidence ?? null) ?? [],
    checkedOn: r.checked_on ?? null,
  }));
}

/** What changes on one row. A field that is left out stays as it is; a field given as null is emptied. */
export type RowPatch = {
  n: number;
  door?: DoorSign | null;
  doorTries?: number;
  pages?: PagesSign | null;
  pagesTries?: number;
  reads?: ReadItem[] | null;
  outside?: OutsideSign | null;
  verdict?: Verdict | null;
  rule?: number | null;
  lastSeen?: string | null;
  lastSeenFrom?: string | null;
  why?: string | null;
  evidence?: string[] | null;
  checkedOn?: string | null;
};

const ROW_COLUMNS: [keyof RowPatch, string][] = [
  ["door", "door"],
  ["doorTries", "door_tries"],
  ["pages", "pages"],
  ["pagesTries", "pages_tries"],
  ["reads", "reads"],
  ["outside", "outside"],
  ["verdict", "verdict"],
  ["rule", "rule"],
  ["lastSeen", "last_seen"],
  ["lastSeenFrom", "last_seen_from"],
  ["why", "why"],
  ["evidence", "evidence"],
  ["checkedOn", "checked_on"],
];

// One statement for any number of rows. Each patch is one entry of a JSON list; a column is
// changed only where its patch names the field (json_type is NULL for a field that is absent,
// and 'null' for one that is given as null). The rows are named by their numbers first, so the
// database goes straight to them: without that it walked every row of the list on every save.
export const ROWS_UPDATE = `UPDATE rows SET ${ROW_COLUMNS.map(([field, column]) => `${column} = CASE WHEN json_type(p.value, '$.${field}') IS NULL THEN rows.${column} ELSE json_extract(p.value, '$.${field}') END`).join(", ")}
  FROM json_each(?2) AS p WHERE rows.list_id = ?1 AND rows.n IN (SELECT json_extract(value, '$.n') FROM json_each(?2)) AND rows.n = json_extract(p.value, '$.n')`;

/**
 * Saves what a step learned about its rows: one statement for the rows and one that notes the
 * list has moved. `more` are statements that belong to the same piece of work, such as the
 * count of pages read; they are sent in the same batch, so they happen together or not at all.
 * `note` is what the list's page says is being done now; left out, the note stays as it is.
 */
export async function saveRows(db: D1Database, listId: string, patches: RowPatch[], now: string, more: D1PreparedStatement[] = [], note?: string): Promise<void> {
  const statements = [...more, db.prepare("UPDATE lists SET moved_at = ?2, note = COALESCE(?3, note) WHERE id = ?1").bind(listId, now, note ?? null)];
  if (patches.length > 0) statements.unshift(db.prepare(ROWS_UPDATE).bind(listId, JSON.stringify(patches)));
  await db.batch(statements);
}

const WALL: Record<string, string> = { alive: "a", "slowing down": "s", zombie: "z", "could not tell": "u" };

/**
 * Draws the list's wall again from its rows: one character a row, in order. It is drawn from
 * the rows every time and never edited in place, so two runs that overlap cannot spoil it.
 */
export async function refreshWall(db: D1Database, listId: string): Promise<string> {
  const { results } = await db.prepare("SELECT verdict FROM rows WHERE list_id = ? ORDER BY n").bind(listId).all<{ verdict: string | null }>();
  const wall = results.map((r) => (r.verdict === null ? "." : (WALL[r.verdict] ?? "."))).join("");
  await db.prepare("UPDATE lists SET wall = ?2 WHERE id = ?1").bind(listId, wall).run();
  return wall;
}

/** How many rows of a list have no verdict yet, and the first of them. */
export async function rowsLeft(db: D1Database, listId: string): Promise<{ left: number; first: number | null }> {
  const row = await db.prepare("SELECT COUNT(*) AS left, MIN(n) AS first FROM rows WHERE list_id = ? AND verdict IS NULL").bind(listId).first<{ left: number; first: number | null }>();
  return { left: row?.left ?? 0, first: row?.first ?? null };
}

/** `rows` is every row handed in; `decided` is those that have a verdict. */
export type Totals = { lists: number; rows: number; decided: number; alive: number; slowing_down: number; zombie: number; could_not_tell: number; spend_usd: number };

/**
 * The figures at the foot of every page and at /api/stats. They are read from the lists'
 * walls, which hold one letter for each row, and not from the rows: a page view then costs
 * the database one row for each list, however many companies the lists hold.
 */
export async function totals(db: D1Database): Promise<Totals> {
  const [lists, spend] = await db.batch<Record<string, number | string | null>>([db.prepare("SELECT wall FROM lists"), db.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM spend")]);
  const walls = (lists?.results ?? []).map((l) => String(l.wall ?? ""));
  const of = (letter: string): number => walls.reduce((sum, wall) => sum + wall.split(letter).length - 1, 0);
  const rows = walls.reduce((sum, wall) => sum + wall.length, 0);
  return {
    lists: walls.length,
    rows,
    decided: rows - of("."),
    alive: of("a"),
    slowing_down: of("s"),
    zombie: of("z"),
    could_not_tell: of("u"),
    spend_usd: Math.round(Number(spend?.results[0]?.usd ?? 0) * 100) / 100,
  };
}

// ---- Counters ----

/** The most Knock may spend in all, in dollars. 0 unless the setting holds a positive number. */
export function spendCap(env: Env): number {
  const cap = Number(env.SPEND_CAP_USD ?? "0");
  return Number.isFinite(cap) && cap > 0 ? cap : 0;
}

export async function countOf(db: D1Database, day: string, name: string): Promise<number> {
  const row = await db.prepare("SELECT count FROM limits WHERE day = ? AND name = ?").bind(day, name).first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Takes one of `limit` slots for `name` on `day`. True when a slot was free. One statement,
 * so two requests arriving together cannot both take the last slot.
 */
export async function takeSlot(db: D1Database, day: string, name: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const row = await db
    .prepare("INSERT INTO limits (day, name, count) VALUES (?, ?, 1) ON CONFLICT (day, name) DO UPDATE SET count = count + 1 WHERE limits.count < ? RETURNING count")
    .bind(day, name, limit)
    .first<{ count: number }>();
  return row !== null;
}

/**
 * Takes up to `n` of `limit` slots for `name` on `day`, and says how many it got. The count
 * before and the count after are read in one batch, which the database runs as one piece, so
 * two runs asking together cannot both be given the last slots.
 */
export async function takeMany(db: D1Database, day: string, name: string, n: number, limit: number): Promise<number> {
  if (n <= 0 || limit <= 0) return 0;
  const [before, after] = await db.batch<{ count: number }>([
    db.prepare("SELECT count FROM limits WHERE day = ?1 AND name = ?2").bind(day, name),
    db
      .prepare("INSERT INTO limits (day, name, count) VALUES (?1, ?2, MIN(?3, ?4)) ON CONFLICT (day, name) DO UPDATE SET count = MAX(limits.count, MIN(limits.count + ?3, ?4)) RETURNING count")
      .bind(day, name, n, limit),
  ]);
  const had = before?.results[0]?.count ?? 0;
  return Math.max((after?.results[0]?.count ?? had) - had, 0);
}

/** Gives `n` slots back. */
export async function giveBack(db: D1Database, day: string, name: string, n = 1): Promise<void> {
  await db.prepare("UPDATE limits SET count = MAX(count - ?3, 0) WHERE day = ?1 AND name = ?2").bind(day, name, n).run();
}

/** The statement that counts `n` more pages read on `day`. It is sent together with the rows those pages belong to. */
export function countReads(db: D1Database, day: string, n: number): D1PreparedStatement {
  return db.prepare("INSERT INTO limits (day, name, count) VALUES (?1, 'reads', ?2) ON CONFLICT (day, name) DO UPDATE SET count = count + ?2").bind(day, n);
}

const readsSoFar = (db: D1Database, day: string): D1PreparedStatement =>
  db.prepare("SELECT COALESCE(SUM(CASE WHEN day = ?1 THEN count ELSE 0 END), 0) AS today, COALESCE(SUM(MAX(count - ?2, 0)), 0) AS paid FROM limits WHERE name = 'reads'").bind(day, FREE_READS_PER_DAY);

const leftOf = (env: Env, row: { today: number; paid: number } | null | undefined): number => {
  const free = Math.max(FREE_READS_PER_DAY - (row?.today ?? 0), 0);
  const payable = Math.floor(Math.min(READS_USD_MAX, spendCap(env)) / READ_USD);
  return free + Math.max(payable - (row?.paid ?? 0), 0);
};

/**
 * How many pages Knock may still read now: what is left of the day's free pages, and, when a
 * cap is set, what is left of the pages it may pay for in all.
 */
export async function readsLeft(env: Env, day: string): Promise<number> {
  return leftOf(env, await readsSoFar(env.DB, day).first<{ today: number; paid: number }>());
}

/** Where a list stands, and how many pages may still be read: what a leg asks before it reads. */
export async function standing(env: Env, listId: string, day: string): Promise<{ attempt: number | null; status: ListStatus | null; readsLeft: number }> {
  const [list, reads] = await env.DB.batch<Record<string, number | string>>([env.DB.prepare("SELECT attempt, status FROM lists WHERE id = ?").bind(listId), readsSoFar(env.DB, day)]);
  const line = list?.results[0];
  const sums = reads?.results[0];
  return {
    attempt: line === undefined ? null : Number(line.attempt),
    status: line === undefined ? null : line.status === "done" ? "done" : line.status === "waiting" ? "waiting" : "working",
    readsLeft: leftOf(env, sums === undefined ? null : { today: Number(sums.today), paid: Number(sums.paid) }),
  };
}

/**
 * The statement that books what the pages just counted cost: only those beyond the day's free
 * ones. It is sent right after `countReads`, in the same batch.
 */
export function bookReads(db: D1Database, day: string, n: number, now: string, ref: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO spend (at, kind, amount_usd, ref) SELECT ?1, 'reads', MIN(?2, count - ?3) * ?4, ?5 FROM limits WHERE day = ?6 AND name = 'reads' AND count > ?3")
    .bind(now, n, FREE_READS_PER_DAY, READ_USD, ref, day);
}

/**
 * Takes up to `want` of this minute's searches, and reads where the list stands and how many
 * searches the day has seen, in one batch. `granted` is how many the minute gave.
 */
export async function takeSearches(db: D1Database, listId: string, day: string, minute: string, want: number, perMinute: number): Promise<{ attempt: number | null; status: ListStatus | null; granted: number; dayUsed: number }> {
  const name = `search:${minute}`;
  const [list, before, after, used] = await db.batch<Record<string, number | string>>([
    db.prepare("SELECT attempt, status FROM lists WHERE id = ?").bind(listId),
    db.prepare("SELECT count FROM limits WHERE day = ?1 AND name = ?2").bind(day, name),
    db
      .prepare("INSERT INTO limits (day, name, count) VALUES (?1, ?2, MIN(?3, ?4)) ON CONFLICT (day, name) DO UPDATE SET count = MAX(limits.count, MIN(limits.count + ?3, ?4)) RETURNING count")
      .bind(day, name, want, perMinute),
    db.prepare("SELECT count FROM limits WHERE day = ?1 AND name = 'search'").bind(day),
  ]);
  const had = Number(before?.results[0]?.count ?? 0);
  const line = list?.results[0];
  return {
    attempt: line === undefined ? null : Number(line.attempt),
    status: line === undefined ? null : line.status === "done" ? "done" : line.status === "waiting" ? "waiting" : "working",
    granted: Math.max(Number(after?.results[0]?.count ?? had) - had, 0),
    dayUsed: Number(used?.results[0]?.count ?? 0),
  };
}

/** The statement that counts `n` more searches on `day`. It is sent together with the rows they were asked for. */
export function countSearches(db: D1Database, day: string, n: number): D1PreparedStatement {
  return db.prepare("INSERT INTO limits (day, name, count) VALUES (?1, 'search', ?2) ON CONFLICT (day, name) DO UPDATE SET count = count + ?2").bind(day, n);
}
