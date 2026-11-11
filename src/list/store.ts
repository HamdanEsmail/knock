// Everything Knock keeps in the database. No other file writes SQL.
import { FREE_READS_PER_DAY, READS_USD_MAX, READ_USD } from "../core/limits";
import type { Env } from "../env";

export type Totals = { lists: number; rows: number; alive: number; slowing_down: number; zombie: number; could_not_tell: number; spend_usd: number };

/** The figures at the foot of every page and at /api/stats. */
export async function totals(db: D1Database): Promise<Totals> {
  const [lists, rows, spend] = await db.batch<Record<string, number | string | null>>([
    db.prepare("SELECT COUNT(*) AS lists FROM lists"),
    db.prepare("SELECT verdict, COUNT(*) AS n FROM rows GROUP BY verdict"),
    db.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM spend"),
  ]);
  const by = new Map((rows?.results ?? []).map((r) => [r.verdict, Number(r.n)]));
  const of = (verdict: string) => by.get(verdict) ?? 0;
  return {
    lists: Number(lists?.results[0]?.lists ?? 0),
    rows: [...by.values()].reduce((a, b) => a + b, 0),
    alive: of("alive"),
    slowing_down: of("slowing down"),
    zombie: of("zombie"),
    could_not_tell: of("could not tell"),
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

/** The statement that counts `n` more pages read on `day`. It is sent together with the rows those pages belong to. */
export function countReads(db: D1Database, day: string, n: number): D1PreparedStatement {
  return db.prepare("INSERT INTO limits (day, name, count) VALUES (?1, 'reads', ?2) ON CONFLICT (day, name) DO UPDATE SET count = count + ?2").bind(day, n);
}

/**
 * How many pages Knock may still read now: what is left of the day's free pages, and, when a
 * cap is set, what is left of the pages it may pay for in all.
 */
export async function readsLeft(env: Env, day: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN day = ?1 THEN count ELSE 0 END), 0) AS today, COALESCE(SUM(MAX(count - ?2, 0)), 0) AS paid FROM limits WHERE name = 'reads'")
    .bind(day, FREE_READS_PER_DAY)
    .first<{ today: number; paid: number }>();
  const free = Math.max(FREE_READS_PER_DAY - (row?.today ?? 0), 0);
  const payable = Math.floor(Math.min(READS_USD_MAX, spendCap(env)) / READ_USD);
  return free + Math.max(payable - (row?.paid ?? 0), 0);
}
