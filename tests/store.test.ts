import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { GROUP_ROWS } from "../src/core/limits";
import type { DoorSign, PagesSign } from "../src/core/signs";
import { countOf, getList, giveBack, insertList, listRows, loadGroup, patchList, refreshWall, saveRows, takeMany, type NewRow } from "../src/list/store";
import { counted } from "./helpers/count-db";

const NOW = "2026-11-12T08:00:00.000Z";

const door = (over: Partial<DoorSign> = {}): DoorSign => ({
  kind: "answers",
  asked: "https://acme.com/",
  finalUrl: "https://acme.com/",
  toHost: null,
  namesIt: null,
  title: "Acme",
  chars: 4000,
  serverDate: null,
  jobsLink: null,
  signupLink: null,
  error: null,
  knocks: 1,
  ...over,
});

const pages: PagesSign = { host: "acme.com", done: true, asked: ["12"], found: "12", newest: { url: "https://acme.com/blog/new", title: "New", date: "2026-10-01" }, second: null, count: 1, undated: 0, failed: null };

const sheet = (n: number): NewRow[] =>
  Array.from({ length: n }, (_, i) => ({ n: i, cells: [`Company ${i}`, `company${i}.com`, 'a "quoted", cell'], name: `Company ${i}`, address: i % 10 === 9 ? null : `https://company${i}.com/` }));

const list = (id: string) => ({ id, title: "A test list", source: "csv" as const, owner: "mine" as const, header: ["Company", "Website", "Note"], nameCol: 0, addressCol: 1, now: NOW });

beforeEach(async () => {
  for (const table of ["rows", "lists", "limits", "spend"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("a list in the database", () => {
  it("writes 1,000 rows with fewer than ten queries", async () => {
    const c = counted(env.DB);
    await insertList(c.db, list("l1"), sheet(1000));
    expect(c.queries()).toBeLessThan(10);

    const saved = await getList(env.DB, "l1");
    expect(saved).toMatchObject({ id: "l1", title: "A test list", owner: "mine", header: ["Company", "Website", "Note"], nameCol: 0, addressCol: 1, rowCount: 1000, status: "working", attempt: 0, wakeAt: null, finishedAt: null });
    expect(saved?.wall).toBe(".".repeat(1000));
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM rows WHERE list_id = 'l1'").first("n")).toBe(1000);
  });

  it("keeps a row's own cells exactly, and marks a row without an address", async () => {
    await insertList(env.DB, list("l1"), sheet(20));
    const rows = await loadGroup(env.DB, "l1", 0);
    expect(rows).toHaveLength(20);
    expect(rows[3]).toMatchObject({ n: 3, name: "Company 3", address: "https://company3.com/", door: null, doorTries: 0, pages: null, pagesTries: 0, reads: null, outside: null, verdict: null });
    expect(rows[9]).toMatchObject({ n: 9, address: null });
    expect(rows[9]?.door).toMatchObject({ kind: "no_address", asked: null, knocks: 0 });
    const full = await listRows(env.DB, "l1", { from: 3, count: 1 });
    expect(full[0]?.cells).toEqual(["Company 3", "company3.com", 'a "quoted", cell']);
  });

  it("loads a group: forty rows, in the sheet's order", async () => {
    await insertList(env.DB, list("l1"), sheet(95));
    expect((await loadGroup(env.DB, "l1", 0)).map((r) => r.n)).toEqual(Array.from({ length: GROUP_ROWS }, (_, i) => i));
    expect((await loadGroup(env.DB, "l1", 2)).map((r) => r.n)).toEqual([80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94]);
    expect(await loadGroup(env.DB, "l1", 3)).toEqual([]);
  });

  it("saves many rows with one statement, and a patch changes only what it names", async () => {
    await insertList(env.DB, list("l1"), sheet(50));
    await insertList(env.DB, list("l2"), sheet(5));
    const c = counted(env.DB);
    await saveRows(c.db, "l1", [
      { n: 0, door: door(), doorTries: 1 },
      { n: 1, door: door({ kind: "gone", finalUrl: null, error: "invalid_url" }), doorTries: 1, pages, pagesTries: 2 },
      { n: 2, verdict: "zombie", rule: 3, lastSeen: "2019-05-01", lastSeenFrom: "date from search", why: 'It said "gone", twice.', evidence: ["https://company2.com/"], checkedOn: "2026-11-12" },
    ], "2026-11-12T08:05:00.000Z");
    // The rows in one statement, and the list's "last moved" in another.
    expect(c.queries()).toBe(2);

    const rows = await loadGroup(env.DB, "l1", 0);
    expect(rows[0]).toMatchObject({ door: door(), doorTries: 1, pages: null, pagesTries: 0, verdict: null });
    expect(rows[1]).toMatchObject({ door: { kind: "gone", error: "invalid_url" }, pages, pagesTries: 2 });
    expect(rows[3]).toMatchObject({ door: null, doorTries: 0, pages: null });
    const [third] = await listRows(env.DB, "l1", { from: 2, count: 1 });
    expect(third).toMatchObject({ verdict: "zombie", rule: 3, lastSeen: "2019-05-01", lastSeenFrom: "date from search", why: 'It said "gone", twice.', evidence: ["https://company2.com/"], checkedOn: "2026-11-12" });

    // A later patch that names one thing leaves the rest of the row as it was.
    await saveRows(env.DB, "l1", [{ n: 1, pagesTries: 3 }, { n: 2, why: null }], "2026-11-12T08:06:00.000Z");
    const after = await loadGroup(env.DB, "l1", 0);
    expect(after[1]).toMatchObject({ door: { kind: "gone" }, pages, pagesTries: 3 });
    const [again] = await listRows(env.DB, "l1", { from: 2, count: 1 });
    expect(again).toMatchObject({ verdict: "zombie", why: null, evidence: ["https://company2.com/"] });

    // Another list's rows are not touched, and the list knows it moved.
    expect((await loadGroup(env.DB, "l2", 0))[0]).toMatchObject({ door: null });
    expect((await getList(env.DB, "l1"))?.movedAt).toBe("2026-11-12T08:06:00.000Z");
    expect((await getList(env.DB, "l2"))?.movedAt).toBe(NOW);
  });

  it("draws the wall again from the rows, one character a row", async () => {
    await insertList(env.DB, list("l1"), sheet(6));
    await saveRows(env.DB, "l1", [{ n: 0, verdict: "alive" }, { n: 2, verdict: "slowing down" }, { n: 3, verdict: "zombie" }, { n: 5, verdict: "could not tell" }], NOW);
    expect(await refreshWall(env.DB, "l1")).toBe("a.sz.u");
    expect((await getList(env.DB, "l1"))?.wall).toBe("a.sz.u");
  });

  it("lists rows a page at a time, and by verdict", async () => {
    await insertList(env.DB, list("l1"), sheet(12));
    await saveRows(env.DB, "l1", [{ n: 4, verdict: "zombie" }, { n: 7, verdict: "zombie" }, { n: 8, verdict: "alive" }], NOW);
    expect((await listRows(env.DB, "l1", { from: 5, count: 3 })).map((r) => r.n)).toEqual([5, 6, 7]);
    expect((await listRows(env.DB, "l1", { from: 0, count: 50, verdict: "zombie" })).map((r) => r.n)).toEqual([4, 7]);
  });

  it("changes a list's state", async () => {
    await insertList(env.DB, list("l1"), sheet(3));
    await patchList(env.DB, "l1", { status: "waiting", note: "Waiting for tomorrow's pages.", wakeAt: "2026-11-13T00:00:00.000Z", attempt: 2 });
    expect(await getList(env.DB, "l1")).toMatchObject({ status: "waiting", note: "Waiting for tomorrow's pages.", wakeAt: "2026-11-13T00:00:00.000Z", attempt: 2, finishedAt: null });
    await patchList(env.DB, "l1", { status: "done", note: "", wakeAt: null, finishedAt: "2026-11-13T01:00:00.000Z" });
    expect(await getList(env.DB, "l1")).toMatchObject({ status: "done", wakeAt: null, attempt: 2, finishedAt: "2026-11-13T01:00:00.000Z" });
    expect(await getList(env.DB, "nope")).toBeNull();
  });
});

describe("the counters", () => {
  it("gives as many slots as are left, and says how many", async () => {
    expect(await takeMany(env.DB, "2026-11-12", "search:08:00", 5, 7)).toBe(5);
    expect(await takeMany(env.DB, "2026-11-12", "search:08:00", 5, 7)).toBe(2);
    expect(await takeMany(env.DB, "2026-11-12", "search:08:00", 5, 7)).toBe(0);
    expect(await countOf(env.DB, "2026-11-12", "search:08:00")).toBe(7);
    // Another minute has its own.
    expect(await takeMany(env.DB, "2026-11-12", "search:08:01", 9, 7)).toBe(7);
    expect(await takeMany(env.DB, "2026-11-12", "search:08:02", 0, 7)).toBe(0);
  });

  it("gives slots back, never below nothing", async () => {
    await takeMany(env.DB, "2026-11-12", "lists", 2, 3);
    await giveBack(env.DB, "2026-11-12", "lists");
    expect(await countOf(env.DB, "2026-11-12", "lists")).toBe(1);
    await giveBack(env.DB, "2026-11-12", "lists", 5);
    expect(await countOf(env.DB, "2026-11-12", "lists")).toBe(0);
  });
});
