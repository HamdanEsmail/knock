import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { parseCsv } from "../src/core/csv";
import { KNOCK_HEADER } from "../src/core/sheet";
import type { DoorSign } from "../src/core/signs";
import type { Env } from "../src/env";
import { getList, loadGroup, refreshWall, saveRows } from "../src/list/store";

const app = createApp();

// A stand-in for the Workflow binding: it only remembers the runs it was asked to start.
let runs: { id: string; params: unknown }[] = [];
let broken = false;
const testEnv = (): Env =>
  ({
    ...env,
    LIST_WORKFLOW: {
      create: async ({ id, params }: { id: string; params: unknown }) => {
        if (broken) throw new Error("no run");
        runs.push({ id, params });
        return {};
      },
      get: async () => {
        throw new Error("not found");
      },
    },
  }) as unknown as Env;

const call = (path: string, init?: RequestInit) => app.request(`https://knock.test${path}`, init, testEnv());
const post = (path: string, body: unknown, headers: Record<string, string> = {}) => call(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const admin = { authorization: "Bearer test-admin" };

const SHEET = 'Company,Website,Note\nStripe,stripe.com,"pays, ""fast"""\nParse,parse.com,=SUM(A1)\nNo Site,,\n';

async function handIn(csv = SHEET, headers: Record<string, string> = admin): Promise<string> {
  const res = await post("/api/lists", { csv }, headers);
  expect(res.status).toBe(202);
  return ((await res.json()) as { id: string }).id;
}

const door: DoorSign = { kind: "answers", asked: "https://stripe.com/", finalUrl: "https://stripe.com/", toHost: null, namesIt: null, title: "Stripe", chars: 9000, serverDate: null, jobsLink: null, signupLink: null, error: null, knocks: 1 };

/** Gives the first two rows of a list their signs and verdicts, as a finished check would. */
async function decide(id: string) {
  await saveRows(
    env.DB,
    id,
    [
      { n: 0, door, pages: { host: "stripe.com", done: true, asked: ["12"], found: "12", newest: { url: "https://stripe.com/blog/a", title: "A", date: "2026-11-05" }, second: null, count: 2, undated: 0, failed: null }, reads: [], verdict: "alive", rule: 5, lastSeen: "2026-11-05", lastSeenFrom: "date from search", why: "Read today: a page of its site.", evidence: ["https://stripe.com/blog/a", "https://stripe.com/"], checkedOn: "2026-11-12" },
      { n: 1, door: { ...door, kind: "gone", asked: "https://parse.com/", finalUrl: null, error: "invalid_url", knocks: 2 }, reads: [], verdict: "zombie", rule: 3, why: "The address no longer exists. It was asked twice.", evidence: ["https://parse.com/"], checkedOn: "2026-11-12" },
    ],
    "2026-11-12T08:30:00.000Z",
  );
  await refreshWall(env.DB, id);
}

beforeEach(async () => {
  runs = [];
  broken = false;
  for (const table of ["rows", "lists", "limits", "spend", "sets"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("handing a sheet in", () => {
  it("takes a sheet as JSON, starts its check and says where to watch it", async () => {
    const res = await post("/api/lists", { csv: SHEET, title: "My vendors" }, {});
    expect(res.status).toBe(202);
    const body = (await res.json()) as { id: string; url: string; api: string; csv: string; rows: number };
    expect(body).toEqual({ id: body.id, url: `https://knock.test/l/${body.id}`, api: `https://knock.test/api/lists/${body.id}`, csv: `https://knock.test/api/lists/${body.id}/csv`, rows: 3 });
    expect(runs).toEqual([{ id: `${body.id}-a0-g0-doors-0`, params: { listId: body.id, attempt: 0, leg: { group: 0, stage: "doors", turn: 0 } } }]);
    expect(await getList(env.DB, body.id)).toMatchObject({ title: "My vendors", owner: "visitor", rowCount: 3 });
  });

  it("takes a sheet as plain CSV, with the title in the address", async () => {
    const res = await call("/api/lists?title=From%20a%20file", { method: "POST", headers: { "content-type": "text/csv" }, body: SHEET });
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect(await getList(env.DB, id)).toMatchObject({ title: "From a file", rowCount: 3, nameCol: 0, addressCol: 1 });
  });

  it("takes the caller's columns", async () => {
    const res = await post("/api/lists", { csv: "a,b,c\nx,Acme,acme.com\n", name_col: 1, address_col: 2, first_line_is_header: true });
    const { id } = (await res.json()) as { id: string };
    expect((await loadGroup(env.DB, id, 0))[0]).toMatchObject({ name: "Acme", address: "https://acme.com/" });
  });

  it("says why it refuses a sheet", async () => {
    const empty = await post("/api/lists", { csv: "" });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "empty_sheet", message: expect.stringMatching(/empty/) });

    const many = await post("/api/lists", { csv: `name,url\n${Array.from({ length: 1001 }, (_, i) => `C${i},c${i}.com`).join("\n")}` });
    expect(many.status).toBe(400);
    expect(await many.json()).toMatchObject({ error: "too_many_rows", message: expect.stringMatching(/1,001 rows/) });

    const notJson = await call("/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ error: "bad_request" });
    expect(runs).toEqual([]);
  });

  it("takes three lists a day from visitors; mine come in with the admin token and are not counted", async () => {
    for (let i = 0; i < 3; i++) expect((await post("/api/lists", { csv: SHEET })).status).toBe(202);
    const fourth = await post("/api/lists", { csv: SHEET });
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toMatchObject({ error: "daily_limit", message: expect.stringMatching(/midnight UTC/) });
    const mine = await post("/api/lists", { csv: SHEET }, admin);
    expect(mine.status).toBe(202);
    expect(await getList(env.DB, ((await mine.json()) as { id: string }).id)).toMatchObject({ owner: "mine" });
    // A wrong token is a visitor.
    expect((await post("/api/lists", { csv: SHEET }, { authorization: "Bearer wrong" })).status).toBe(429);
  });

  it("keeps nothing when the check cannot be started", async () => {
    broken = true;
    const res = await post("/api/lists", { csv: SHEET });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "could_not_start" });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM lists").first("n")).toBe(0);
  });
});

describe("watching a list", () => {
  it("says where a list stands: its counts, its wall and what is being done", async () => {
    const id = await handIn();
    await decide(id);
    const res = await call(`/api/lists/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id,
      title: "A list of 3 companies",
      status: "working",
      rows: 3,
      decided: 2,
      counts: { alive: 1, slowing_down: 0, zombie: 1, could_not_tell: 0, not_yet: 1 },
      wall: "az.",
      wake_at: null,
      finished_at: null,
      csv: `https://knock.test/api/lists/${id}/csv`,
    });
    expect((await call("/api/lists/nothere")).status).toBe(404);
  });

  it("gives the rows a page at a time, each with its signs in words, and by verdict", async () => {
    const id = await handIn();
    await decide(id);
    const all = (await (await call(`/api/lists/${id}/rows`)).json()) as { rows: Record<string, unknown>[]; next: number | null };
    expect(all.rows).toHaveLength(3);
    expect(all.next).toBeNull();
    expect(all.rows[0]).toMatchObject({
      n: 0,
      name: "Stripe",
      address: "https://stripe.com/",
      verdict: "alive",
      last_seen: "2026-11-05",
      last_seen_from: "date from search",
      why: "Read today: a page of its site.",
      door: expect.stringContaining("answers"),
      evidence: ["https://stripe.com/blog/a", "https://stripe.com/"],
      checked_on: "2026-11-12",
    });
    expect(all.rows[2]).toMatchObject({ n: 2, name: "No Site", address: null, verdict: null });

    const two = (await (await call(`/api/lists/${id}/rows?from=1&count=1`)).json()) as { rows: { n: number }[]; next: number | null };
    expect(two.rows.map((r) => r.n)).toEqual([1]);
    expect(two.next).toBe(2);
    const zombies = (await (await call(`/api/lists/${id}/rows?verdict=zombie`)).json()) as { rows: { n: number }[] };
    expect(zombies.rows.map((r) => r.n)).toEqual([1]);
    expect((await call(`/api/lists/${id}/rows?verdict=dead`)).status).toBe(400);
    expect((await call("/api/lists/nothere/rows")).status).toBe(404);
  });
});

describe("the totals", () => {
  it("count a row as decided only when it has a verdict, in the API and at the foot of every page", async () => {
    const id = await handIn();
    await decide(id);
    expect(await (await call("/api/stats")).json()).toEqual({ lists: 1, rows: 3, decided: 2, alive: 1, slowing_down: 0, zombie: 1, could_not_tell: 0, spend_usd: 0 });
    const html = await (await call("/")).text();
    expect(html).toContain("1 list · 2 rows decided · TinyFish spend $0.00");
  });
});

describe("the sheet that comes back", () => {
  it("is the visitor's own sheet, cell for cell, with thirteen columns added", async () => {
    const id = await handIn();
    await decide(id);
    const res = await call(`/api/lists/${id}/csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="knock-${id}.csv"`);
    const text = await res.text();
    const lines = parseCsv(text);
    expect(lines[0]).toEqual(["Company", "Website", "Note", ...KNOCK_HEADER]);
    expect(lines).toHaveLength(4);
    // The visitor's own cells are untouched, a formula of theirs included.
    expect(lines[1]?.slice(0, 3)).toEqual(["Stripe", "stripe.com", 'pays, "fast"']);
    expect(lines[2]?.slice(0, 3)).toEqual(["Parse", "parse.com", "=SUM(A1)"]);
    expect(lines[3]?.slice(0, 3)).toEqual(["No Site", "", ""]);
    for (const line of lines) expect(line).toHaveLength(16);

    expect(lines[1]?.slice(3, 7)).toEqual(["alive", "2026-11-05", "date from search", "Read today: a page of its site."]);
    expect(lines[1]?.[12]).toBe("https://stripe.com/blog/a");
    expect(lines[1]?.[15]).toBe("2026-11-12");
    expect(lines[2]?.[3]).toBe("zombie");
    // A row that has not been decided has its verdict cells empty, and still says what is known.
    expect(lines[3]?.slice(3, 7)).toEqual(["", "", "", ""]);
    expect(lines[3]?.[7]).toMatch(/no address/i);
    expect((await call("/api/lists/nothere/csv")).status).toBe(404);
  });

  it("names the columns itself when the sheet had no first line of its own", async () => {
    const id = await handIn("Stripe,stripe.com\nParse,parse.com\n");
    const lines = parseCsv(await (await call(`/api/lists/${id}/csv`)).text());
    expect(lines[0]).toEqual(["column_1", "column_2", ...KNOCK_HEADER]);
    expect(lines[1]?.slice(0, 2)).toEqual(["Stripe", "stripe.com"]);
    expect(lines).toHaveLength(3);
  });
});

describe("carry on", () => {
  it("does nothing to a list that is working, and says so", async () => {
    const id = await handIn();
    runs = [];
    const res = await call(`/api/lists/${id}/carry-on`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ state: "still working", message: expect.stringMatching(/ten minutes/) });
    expect(runs).toEqual([]);
    expect((await call("/api/lists/nothere/carry-on", { method: "POST" })).status).toBe(404);
  });

  it("starts a list that has not moved for ten minutes, under a new attempt", async () => {
    const id = await handIn();
    runs = [];
    await env.DB.prepare("UPDATE lists SET moved_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").bind(id).run();
    const res = await call(`/api/lists/${id}/carry-on`, { method: "POST" });
    expect(await res.json()).toMatchObject({ state: "started" });
    expect(runs).toEqual([{ id: `${id}-a1-g0-doors-0`, params: { listId: id, attempt: 1, leg: { group: 0, stage: "doors", turn: 0 } } }]);
  });
});

describe("the board's other pages", () => {
  it("shows a row with its door, its verdict and every sign, and nothing for a row that is not there", async () => {
    const id = await handIn();
    await env.DB.prepare("UPDATE rows SET verdict = 'zombie', rule = 3, why = 'The address no longer exists. It was asked twice.', evidence = '[\"https://stripe.com/\"]', checked_on = '2026-11-12' WHERE list_id = ? AND n = 0")
      .bind(id)
      .run();
    const html = await (await call(`/l/${id}/r/1`)).text();
    expect(html).toContain("Stripe");
    expect(html).toContain("The address no longer exists. It was asked twice.");
    expect(html).toContain("A door with its light out");
    expect(html).toContain("Checked on 12 Nov 2026.");
    expect(html).toContain(`href="/l/${id}"`);
    expect(html).toContain("TinySet was not asked about this row.");
    expect((await call(`/l/${id}/r/0`)).status).toBe(404);
    expect((await call(`/l/${id}/r/99`)).status).toBe(404);
    expect((await call("/l/nosuchlist/r/1")).status).toBe(404);
  });

  it("explains how it works, with the API written for this site's own address", async () => {
    const html = await (await call("/how")).text();
    expect(html).toContain("The six signs");
    expect(html).toContain("Where TinySet comes in");
    expect(html).toContain("https://knock.test/api/lists");
    expect(html).toContain("Built by");
  });

  it("sends The example to the list on the first page, and to the first page when there is none", async () => {
    expect((await call("/example")).headers.get("location")).toBe("/");
    const id = await handIn();
    await env.DB.prepare("UPDATE lists SET featured = 1 WHERE id = ?").bind(id).run();
    expect((await call("/example")).headers.get("location")).toBe(`/l/${id}`);
    const home = await (await call("/")).text();
    expect(home).toContain(`href="/l/${id}"`);
    expect(home).toContain("One door for each company, by Knock&#39;s own check.");
  });

  it("knocks on one door only when asked by the form, and refuses what is not an address", async () => {
    expect((await call("/knock")).headers.get("location")).toBe("/");
    const refused = await call("/knock", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "address=not+an+address" });
    expect(refused.status).toBe(400);
    expect(await refused.text()).toContain("That is not a web address Knock can ask.");
    const api = await post("/api/knock", { address: "" });
    expect(api.status).toBe(400);
    expect(await api.json()).toMatchObject({ error: "bad_address" });
  });
});

describe("my own routes", () => {
  it("need the admin token", async () => {
    const id = await handIn();
    expect((await call(`/api/admin/lists/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await call(`/api/admin/lists/${id}/feature`, { method: "POST" })).status).toBe(403);
  });

  it("put a list on the first page and remove a list", async () => {
    const id = await handIn();
    expect(await (await call(`/api/admin/lists/${id}/feature`, { method: "POST", headers: admin })).json()).toEqual({ id, featured: true });
    expect((await getList(env.DB, id))?.featured).toBe(true);
    expect(await (await call(`/api/admin/lists/${id}/feature?off=1`, { method: "POST", headers: admin })).json()).toEqual({ id, featured: false });
    expect(await (await call(`/api/admin/lists/${id}`, { method: "DELETE", headers: admin })).json()).toEqual({ deleted: id });
    expect(await getList(env.DB, id)).toBeNull();
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM rows").first("n")).toBe(0);
  });

  it("start a set for TinySet only with the admin token, only for a finished list, and only under the cap", async () => {
    const id = await handIn();
    expect((await post(`/api/admin/lists/${id}/wave`, {})).status).toBe(403);
    expect((await call(`/api/admin/lists/${id}/sets`)).status).toBe(403);
    expect((await call("/api/admin/sets/s123/carry-on", { method: "POST" })).status).toBe(403);
    const early = await post(`/api/admin/lists/${id}/wave`, {}, admin);
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ error: "list_not_done" });
    await env.DB.prepare("UPDATE lists SET status = 'done', finished_at = ?2 WHERE id = ?1").bind(id, new Date().toISOString()).run();
    // The tests run with the cap at nothing, so no set may start, and no call leaves for TinyFish.
    const capped = await post(`/api/admin/lists/${id}/wave`, { rows: [0, 1] }, admin);
    expect(capped.status).toBe(402);
    expect(await capped.json()).toMatchObject({ error: "cap" });
    expect(await (await call(`/api/admin/lists/${id}/sets`, { headers: admin })).json()).toEqual({ sets: [] });
    expect((await call("/api/admin/sets/s123/carry-on", { method: "POST", headers: admin })).status).toBe(404);
  });

  it("decide a finished list again from its stored signs, with the admin token only", async () => {
    const id = await handIn();
    expect((await call(`/api/admin/lists/${id}/decide-again`, { method: "POST" })).status).toBe(403);
    expect((await call(`/api/admin/lists/${id}/decide-again`, { method: "POST", headers: admin })).status).toBe(409);
    await decide(id);
    await env.DB.prepare("UPDATE lists SET status = 'done' WHERE id = ?").bind(id).run();
    const res = await call(`/api/admin/lists/${id}/decide-again`, { method: "POST", headers: admin });
    expect(await res.json()).toMatchObject({ rows: 3, decided: 2 });
    expect((await call("/api/admin/lists/nosuchlist/decide-again", { method: "POST", headers: admin })).status).toBe(404);
  });

  it("remove a list's sets with the list", async () => {
    const id = await handIn();
    await env.DB.prepare("INSERT INTO sets (id, list_id, rows, status, created_at) VALUES ('s1', ?, '[0]', 'booked', '2026-11-12T00:00:00Z')").bind(id).run();
    await call(`/api/admin/lists/${id}`, { method: "DELETE", headers: admin });
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM sets").first("n")).toBe(0);
  });
});

describe("the pages", () => {
  it("has a first page that takes a sheet and says who built it", async () => {
    const res = await call("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="author" content="Hamdan Esmail"');
    expect(html).toMatch(/Built by <a href="https:\/\/github\.com\/HamdanEsmail" rel="author"[^>]*>Hamdan Esmail<\/a>/);
    expect(html).toContain('action="/lists"');
    expect(html).toContain('type="file"');
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("takes a pasted sheet from the form and goes to the list's page", async () => {
    const res = await call("/lists", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csv: SHEET, title: "Pasted" }).toString() });
    expect(res.status).toBe(303);
    const where = res.headers.get("location") ?? "";
    expect(where).toMatch(/^\/l\/[a-z0-9]{10}$/);
    expect(await getList(env.DB, where.slice(3))).toMatchObject({ title: "Pasted", owner: "visitor" });

    const refused = await call("/lists", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csv: "" }).toString() });
    expect(refused.status).toBe(303);
    // A refusal comes back to the form itself, lower on the first page.
    expect(refused.headers.get("location")).toBe("/?note=empty_sheet#take");
    expect(await (await call("/?note=empty_sheet")).text()).toContain("The sheet is empty.");
  });

  it("shows a list at work: what is being done, how far it is, and that it is still moving", async () => {
    const id = await handIn();
    await decide(id);
    await env.DB.prepare("UPDATE lists SET note = 'Knocking on doors: rows 1 to 3 of 3.' WHERE id = ?").bind(id).run();
    const res = await call(`/l/${id}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("A list of 3 companies");
    expect(html).toContain("Knocking on doors: rows 1 to 3 of 3.");
    expect(html).toContain("2 of 3 rows decided");
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain(`/api/lists/${id}/csv`);
    expect(html).toContain("Stripe");
    expect(html).toContain("The address no longer exists. It was asked twice.");
    expect(html).toContain("Built by");
  });

  it("shows a finished list without reloading, and a waiting list with the hour it carries on", async () => {
    const id = await handIn();
    await env.DB.prepare("UPDATE lists SET status = 'done', note = '', finished_at = '2026-11-12T09:00:00.000Z' WHERE id = ?").bind(id).run();
    const done = await (await call(`/l/${id}`)).text();
    expect(done).not.toContain('http-equiv="refresh"');
    expect(done).toContain("Finished");

    await env.DB.prepare("UPDATE lists SET status = 'waiting', note = 'Today''s pages are read. Knock carries on at midnight UTC.', wake_at = '2026-11-13T00:00:05.000Z' WHERE id = ?").bind(id).run();
    const waiting = await (await call(`/l/${id}`)).text();
    expect(waiting).toContain("Knock carries on at midnight UTC.");
    expect(waiting).toContain("13 Nov 2026, 00:00 UTC");
  });

  it("answers an address that leads nowhere with a page, and the API with JSON", async () => {
    const page = await call("/l/nothere");
    expect(page.status).toBe(404);
    expect(await page.text()).toContain("Built by");
    const api = await call("/api/nothing-here");
    expect(api.status).toBe(404);
    expect(await api.json()).toMatchObject({ error: "not_found" });
  });
});
