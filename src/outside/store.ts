// The sets in the database. Every change of a set's standing is one statement that names the
// standing it must have had, so two runs that overlap cannot both take the same step.
import type { RowState } from "../list/store";
import type { Candidate } from "./pick";

export type SetStatus = "claimed" | "made" | "posted" | "read" | "booked" | "failed";

/** What came back from TinySet for one set. */
export type SetOutcome = { matched: number; offList: string[]; wrongSite: string[]; missing: number[] };

export type SetRecord = {
  id: string;
  listId: string;
  /** The rows that were sent, in the order they were written into the set. */
  rows: number[];
  status: SetStatus;
  attempt: number;
  datasetId: string | null;
  fills: number;
  looks: number;
  walletBefore: number | null;
  endedAt: string | null;
  bookedUsd: number | null;
  outcome: SetOutcome | null;
  note: string;
  createdAt: string;
};

type SetLine = {
  id: string;
  list_id: string;
  rows: string;
  status: string;
  attempt: number;
  dataset_id: string | null;
  fills: number;
  looks: number;
  wallet_before: number | null;
  ended_at: string | null;
  booked_usd: number | null;
  outcome: string | null;
  note: string;
  created_at: string;
};

const toSet = (l: SetLine): SetRecord => ({
  id: l.id,
  listId: l.list_id,
  rows: JSON.parse(l.rows) as number[],
  status: l.status as SetStatus,
  attempt: l.attempt,
  datasetId: l.dataset_id,
  fills: l.fills,
  looks: l.looks,
  walletBefore: l.wallet_before,
  endedAt: l.ended_at,
  bookedUsd: l.booked_usd,
  outcome: l.outcome === null ? null : (JSON.parse(l.outcome) as SetOutcome),
  note: l.note,
  createdAt: l.created_at,
});

export async function getSet(db: D1Database, id: string): Promise<SetRecord | null> {
  const line = await db.prepare("SELECT * FROM sets WHERE id = ?").bind(id).first<SetLine>();
  return line === null ? null : toSet(line);
}

/** The sets of a list, the newest first. */
export async function setsOf(db: D1Database, listId: string): Promise<SetRecord[]> {
  const { results } = await db.prepare("SELECT * FROM sets WHERE list_id = ? ORDER BY created_at DESC").bind(listId).all<SetLine>();
  return results.map(toSet);
}

/** What is needed of every row of a list to choose the ones for a set. */
export async function candidates(db: D1Database, listId: string): Promise<Candidate[]> {
  const { results } = await db
    .prepare("SELECT n, name, json_extract(door, '$.kind') AS door, json_extract(door, '$.namesIt') AS names_it, verdict, rule, set_id FROM rows WHERE list_id = ? ORDER BY n")
    .bind(listId)
    .all<{ n: number; name: string; door: string | null; names_it: number | null; verdict: string | null; rule: number | null; set_id: string | null }>();
  return results.map((r) => ({ n: r.n, name: r.name, door: r.door, namesIt: r.names_it === null ? null : r.names_it === 1, verdict: r.verdict, rule: r.rule, setId: r.set_id }));
}

/** How the books stand: sets that are not finished, and what the finished ones cost. */
export async function setBooks(db: D1Database): Promise<{ inFlight: number; bookedUsd: number }> {
  const [open, spent] = await db.batch<Record<string, number>>([
    db.prepare("SELECT COUNT(*) AS n FROM sets WHERE status NOT IN ('booked', 'failed')"),
    db.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM spend WHERE kind = 'set'"),
  ]);
  return { inFlight: Number(open?.results[0]?.n ?? 0), bookedUsd: Number(spent?.results[0]?.usd ?? 0) };
}

function newSetId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `s${[...bytes].map((b) => (b % 36).toString(36)).join("")}`;
}

/** Gives a set's rows back and marks it as failed. Used only where nothing was filled. */
export async function releaseSet(db: D1Database, id: string, note: string): Promise<void> {
  await db.batch([db.prepare("UPDATE rows SET set_id = NULL WHERE set_id = ?").bind(id), db.prepare("UPDATE sets SET status = 'failed', note = ?2 WHERE id = ?1 AND status IN ('claimed', 'made', 'posted')").bind(id, note)]);
}

/**
 * Takes rows for a new set: the set is written and its rows are marked in one piece. A row
 * belongs to one set only, so when any of them was taken meanwhile the set is undone. Null then.
 */
export async function claimSet(db: D1Database, listId: string, rows: number[], walletBefore: number, now: string): Promise<string | null> {
  const id = newSetId();
  const [, claimed] = await db.batch([
    db.prepare("INSERT INTO sets (id, list_id, rows, status, wallet_before, created_at) VALUES (?1, ?2, ?3, 'claimed', ?4, ?5)").bind(id, listId, JSON.stringify(rows), walletBefore, now),
    db.prepare("UPDATE rows SET set_id = ?1 WHERE list_id = ?2 AND set_id IS NULL AND n IN (SELECT value FROM json_each(?3))").bind(id, listId, JSON.stringify(rows)),
  ]);
  if ((claimed?.meta.changes ?? 0) === rows.length) return id;
  await releaseSet(db, id, "Some of its rows were taken by another set.");
  return null;
}

/** The rows of a set as a leg works on them, in the order they were sent. */
export async function loadRows(db: D1Database, listId: string, rows: number[]): Promise<RowState[]> {
  const { results } = await db
    .prepare("SELECT n, name, address, door, door_tries, pages, pages_tries, reads, outside, verdict FROM rows WHERE list_id = ?1 AND n IN (SELECT value FROM json_each(?2))")
    .bind(listId, JSON.stringify(rows))
    .all<{ n: number; name: string; address: string | null; door: string | null; door_tries: number; pages: string | null; pages_tries: number; reads: string | null; outside: string | null; verdict: string | null }>();
  const parse = <T>(s: string | null): T | null => (s === null ? null : (JSON.parse(s) as T));
  const byNumber = new Map(
    results.map((r) => [r.n, { n: r.n, name: r.name, address: r.address, door: parse(r.door), doorTries: r.door_tries, pages: parse(r.pages), pagesTries: r.pages_tries, reads: parse(r.reads), outside: parse(r.outside), verdict: r.verdict } as RowState]),
  );
  return rows.flatMap((n) => byNumber.get(n) ?? []);
}

const changed = async (statement: D1PreparedStatement): Promise<boolean> => (await statement.run()).meta.changes === 1;

/** The empty dataset exists. */
export function markMade(db: D1Database, id: string, datasetId: string): Promise<boolean> {
  return changed(db.prepare("UPDATE sets SET status = 'made', dataset_id = ?2 WHERE id = ?1 AND status = 'claimed'").bind(id, datasetId));
}

/** Takes the one right to ask for the fill. True for the one caller that got it. */
export function markPosted(db: D1Database, id: string): Promise<boolean> {
  return changed(db.prepare("UPDATE sets SET status = 'posted', fills = 1 WHERE id = ?1 AND status = 'made'").bind(id));
}

/** Takes the one right to ask for the refill. */
export function markRefill(db: D1Database, id: string): Promise<boolean> {
  return changed(db.prepare("UPDATE sets SET fills = 2 WHERE id = ?1 AND status = 'posted' AND fills = 1").bind(id));
}

/** Counts one more look at the fill, and says how many there have been. */
export async function countLook(db: D1Database, id: string): Promise<number> {
  const line = await db.prepare("UPDATE sets SET looks = looks + 1 WHERE id = ? RETURNING looks").bind(id).first<{ looks: number }>();
  return line?.looks ?? 0;
}

/** The statement that marks a set as read. It is sent together with the rows it was laid over. */
export function markRead(db: D1Database, id: string, outcome: SetOutcome, now: string): D1PreparedStatement {
  return db.prepare("UPDATE sets SET status = 'read', ended_at = ?2, outcome = ?3 WHERE id = ?1 AND status = 'posted'").bind(id, now, JSON.stringify(outcome));
}

/** Writes what a set cost into the books and closes it: both, or neither. */
export async function bookSet(db: D1Database, id: string, usd: number, now: string): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO spend (at, kind, amount_usd, ref) SELECT ?2, 'set', ?3, ?1 FROM sets WHERE id = ?1 AND status = 'read'").bind(id, now, usd),
    db.prepare("UPDATE sets SET status = 'booked', booked_usd = ?2 WHERE id = ?1 AND status = 'read'").bind(id, usd),
  ]);
}

/** Raises a set's attempt by one, if it is still the attempt the caller saw and the set is not finished. */
export function raiseSet(db: D1Database, id: string, from: number): Promise<boolean> {
  return changed(db.prepare("UPDATE sets SET attempt = attempt + 1 WHERE id = ?1 AND attempt = ?2 AND status NOT IN ('booked', 'failed')").bind(id, from));
}
