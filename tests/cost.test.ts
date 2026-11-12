// What the database is asked to read. Cloudflare's free plan allows 5 million rows read a
// day across all of an account's databases, so a statement that walks a whole list or the
// whole table on every save or every page view is a fault, however right its answer is.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createList } from "../src/list/create";
import { ROWS_UPDATE, readsLeft, totals } from "../src/list/store";

const plan = async (sql: string, ...values: unknown[]): Promise<string> => {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...values)
    .all<{ detail: string }>();
  return results.map((r) => r.detail).join(" | ");
};

beforeEach(async () => {
  for (const table of ["rows", "lists", "limits", "spend", "sets"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("what the database reads", () => {
  it("changes rows by their number, and does not walk the whole list for a save", async () => {
    expect(await plan(ROWS_UPDATE, "a-list", "[]")).toMatch(/SEARCH rows USING INDEX \S+ \(list_id=\? AND n=\?\)/);
  });

  it("takes the totals from the lists' walls: a row for each list, not a row for each company", async () => {
    const made = await createList(env, { csv: "Company,Website\nA,a.com\nB,b.com\nC,c.com\nD,d.com\n" }, "mine", new Date("2026-11-12T08:00:00Z"), async () => undefined);
    if (!made.ok) throw new Error(made.code);
    // The wall is the list's own summary of its rows. The rows themselves are not read.
    await env.DB.prepare("UPDATE lists SET wall = 'azu.' WHERE id = ?").bind(made.id).run();
    expect(await totals(env.DB)).toEqual({ lists: 1, rows: 4, decided: 3, alive: 1, slowing_down: 0, zombie: 1, could_not_tell: 1, spend_usd: 0 });
  });

  it("sums the pages read without walking the counters of every minute", async () => {
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'reads', 10), ('2026-11-12', 'search:10:00', 7), ('2026-11-12', 'search:10:01', 7)").run();
    expect(await readsLeft(env, "2026-11-12")).toBe(790);
    const names = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'limits'").all<{ name: string }>();
    expect(names.results.map((r) => r.name)).toContain("limits_by_name");
    expect(await plan("SELECT SUM(count) FROM limits WHERE name = 'reads'")).toMatch(/limits_by_name/);
  });
});
