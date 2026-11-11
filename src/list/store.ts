// Everything Knock keeps in the database. No other file writes SQL.

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
