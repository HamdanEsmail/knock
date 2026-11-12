import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { DoorSign } from "../src/core/signs";
import { createList } from "../src/list/create";
import { decideListAgain } from "../src/list/redecide";
import { getList, listRows } from "../src/list/store";

const NOW = new Date("2026-11-20T09:00:00.000Z");
const door = (kind: DoorSign["kind"], address: string): DoorSign => ({ kind, asked: address, finalUrl: address, toHost: null, namesIt: null, title: null, chars: 9000, serverDate: null, jobsLink: null, signupLink: null, error: null, knocks: 1 });

async function list(): Promise<string> {
  const made = await createList(env, { csv: "Company,Website\nForSale,forsale.com\nOpen,open.com\nUnknocked,later.com\n" }, "mine", new Date("2026-11-12T08:00:00.000Z"), async () => undefined);
  if (!made.ok) throw new Error(made.code);
  // Signs as a check on 12 November left them, with verdicts that an older set of rules might have written.
  await env.DB.prepare("UPDATE rows SET door = ?2, reads = '[]', verdict = 'alive', rule = 5, why = 'an old sentence', evidence = '[]', checked_on = '2026-11-12' WHERE list_id = ?1 AND n = 0")
    .bind(made.id, JSON.stringify(door("for_sale", "https://forsale.com/")))
    .run();
  await env.DB.prepare("UPDATE rows SET door = ?2, reads = '[]', verdict = 'could not tell', rule = 9, why = ?3, last_seen = NULL, evidence = '[\"https://open.com/\"]', checked_on = '2026-11-12' WHERE list_id = ?1 AND n = 1")
    .bind(made.id, JSON.stringify(door("answers", "https://open.com/")), "The home page answers, but nothing on the site carries a date and no jobs or sign-up page could be read.")
    .run();
  await env.DB.prepare("UPDATE lists SET status = 'done', finished_at = '2026-11-12T09:00:00.000Z', wall = 'au.' WHERE id = ?").bind(made.id).run();
  return made.id;
}

beforeEach(async () => {
  for (const table of ["rows", "lists", "limits", "spend", "sets"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("deciding a list again from the signs it already holds", () => {
  it("writes what today's rules make of the stored signs, asks nothing, and keeps the day each row was checked", async () => {
    const id = await list();
    expect(await decideListAgain(env, id, NOW)).toEqual({ rows: 3, decided: 2, changed: 1 });
    const rows = await listRows(env.DB, id, { from: 0, count: 10 });
    expect(rows[0]).toMatchObject({ verdict: "zombie", rule: 2, why: "The address is for sale.", checkedOn: "2026-11-12" });
    // A row the rules decide as before is left exactly as it was.
    expect(rows[1]).toMatchObject({ verdict: "could not tell", rule: 9, checkedOn: "2026-11-12" });
    // A row that was never knocked on stays without a verdict.
    expect(rows[2]?.verdict).toBeNull();
    expect((await getList(env.DB, id))?.wall).toBe("zu.");
  });

  it("does nothing to a list that is still being checked, and says so for a list that is not there", async () => {
    const id = await list();
    await env.DB.prepare("UPDATE lists SET status = 'working' WHERE id = ?").bind(id).run();
    expect(await decideListAgain(env, id, NOW)).toBe("not done");
    expect((await listRows(env.DB, id, { from: 0, count: 1 }))[0]?.verdict).toBe("alive");
    expect(await decideListAgain(env, "nosuchlist", NOW)).toBe("not found");
  });
});
