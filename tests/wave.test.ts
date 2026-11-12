import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createList } from "../src/list/create";
import { getList, listRows, totals, type FullRow } from "../src/list/store";
import { getSet } from "../src/outside/store";
import { carryOnSet, runSet, startWave, type SetStep, type WaveAsk } from "../src/outside/wave";
import { counted } from "./helpers/count-db";
import { fetchMock } from "./helpers/fetch-mock";

const AGENT = /^https:\/\/agent\.tinyfish\.ai\/v1\//;
const FETCH = "https://api.fetch.tinyfish.ai";
const START = Date.parse("2026-11-12T12:00:00.000Z");
const PAYING = { ...env, SPEND_CAP_USD: "20" };

// ---- A stand-in TinySet: datasets that fill after a few looks, and a wallet that falls ----

type Row = Record<string, unknown>;
type Dataset = { id: string; status: string; rows: Row[]; runId: string | null; looksLeft: number; coming: Row[]; target: number; spec: { description: string } };

let datasets: Map<string, Dataset>;
/** What each fill of a dataset brings, in the order the fills are asked for. */
let fills: Row[][];
/** How a fill request ends: answered, or it starts the fill and the answer is lost, or it never starts. */
let postMode: "ok" | "answer lost" | "refused";
let looksToFill: number;
let wallet: number;
let walletDown: boolean;
/** How many more times the wallet fails to answer before it answers again. */
let walletFails: number;
let posts: number;
let cancels: number;
/** A dataset that never gets ready. */
let stuck: boolean;
let pages: Map<string, { title?: string; text?: string } | { error: string }>;
let sent: { method: string; path: string }[];
let nowMs: number;
const clock = () => new Date(nowMs);

function world() {
  datasets = new Map();
  fills = [];
  postMode = "ok";
  looksToFill = 2;
  wallet = 30;
  walletDown = false;
  walletFails = 0;
  posts = 0;
  cancels = 0;
  stuck = false;
  pages = new Map();
  sent = [];
  nowMs = START;
  const view = (d: Dataset) => ({ id: d.id, status: d.status, target_rows: d.target, row_count: d.rows.length, run: d.runId === null ? null : { id: d.runId, status: d.status === "populating" ? "running" : "done" } });
  fetchMock.intercept({
    url: AGENT,
    times: Infinity,
    reply: (req, body) => {
      const path = new URL(req.url).pathname.replace("/v1", "");
      sent.push({ method: req.method, path });
      if (path === "/wallet") return walletDown || walletFails-- > 0 ? new Response("{}", { status: 500 }) : Response.json({ available_balance: wallet.toFixed(3), currency: "USD" });
      if (path === "/datasets" && req.method === "POST") {
        const b = body as { spec: { description: string }; target_rows: number; populate: boolean };
        if (b.populate !== false) throw new Error("a dataset was made with a fill");
        const d: Dataset = { id: `ds-${datasets.size + 1}`, status: "empty", rows: [], runId: null, looksLeft: 0, coming: [], target: b.target_rows, spec: b.spec };
        datasets.set(d.id, d);
        return Response.json(view(d), { status: 201 });
      }
      const [, , id, what, runId, verb] = path.split("/");
      const d = datasets.get(id ?? "");
      if (d === undefined) return new Response("{}", { status: 404 });
      if (what === "populate") {
        if (postMode === "refused") return new Response(JSON.stringify({ error: { code: "unavailable" } }), { status: 503 });
        posts++;
        d.status = "populating";
        d.runId = `run-${posts}`;
        d.looksLeft = looksToFill;
        d.coming = fills.shift() ?? [];
        return postMode === "answer lost" ? new Response("gateway timeout", { status: 504 }) : Response.json(view(d), { status: 202 });
      }
      if (what === "rows") return Response.json({ columns: [], rows: d.rows.map((data, i) => ({ _id: `r${i}`, data })), truncated: false });
      if (what === "runs" && verb === "cancel") {
        cancels++;
        d.status = "cancelled";
        void runId;
        return Response.json({ status: "cancelled" });
      }
      if (what === undefined) {
        if (d.status === "populating" && !stuck && --d.looksLeft <= 0) {
          d.status = "ready";
          d.rows.push(...d.coming);
          wallet -= 0.1 * d.coming.length;
          d.coming = [];
        }
        return Response.json(view(d));
      }
      return new Response("{}", { status: 404 });
    },
  });
  fetchMock.intercept({
    method: "POST",
    url: FETCH,
    times: Infinity,
    reply: (_req, body) => {
      const urls = (body as { urls: string[] }).urls;
      sent.push({ method: "POST", path: `fetch ${urls.join(" ")}` });
      const results: unknown[] = [];
      const errors: unknown[] = [];
      for (const url of urls) {
        const page = pages.get(url);
        if (page === undefined) errors.push({ url, error: "target_http_error" });
        else if ("error" in page) errors.push({ url, error: page.error });
        else results.push({ url, final_url: url, title: page.title ?? "A page", text: page.text ?? "Some words about something else entirely. ".repeat(20), links: [] });
      }
      return Response.json({ results, errors });
    },
  });
}

// ---- A stand-in Workflow for sets: legs one after another, an id never started twice ----

type Queued = { setId: string; attempt: number; turn: number };
let queue: Queued[];
let seen: Set<string>;
let ran: { id: string; requests: number; queries: number }[];
let slept: { name: string; ms: number }[];
let onceTwice: boolean;

function enqueue(setId: string, attempt: number, turn: number) {
  const id = `${setId}-a${attempt}-t${turn}`;
  if (seen.has(id)) throw new Error(`a run with the id ${id} exists already`);
  seen.add(id);
  queue.push({ setId, attempt, turn });
}

async function drive(use: typeof env = PAYING, max = Infinity): Promise<void> {
  for (let n = 0; n < max && queue.length > 0; n++) {
    const { setId, attempt, turn } = queue.shift()!;
    const db = counted(env.DB);
    const before = sent.length;
    const twice = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fn();
      }
    };
    const step: SetStep = {
      do: (_name, fn) => {
        nowMs += 1000;
        return twice(fn);
      },
      once: async (_name, fn) => {
        nowMs += 1000;
        // A faulty engine that runs the paid step a second time.
        if (onceTwice) await fn().catch(() => undefined);
        return fn();
      },
      sleep: async (name, ms) => {
        slept.push({ name, ms });
        nowMs += ms;
      },
      handOver: async (next) => enqueue(setId, attempt, next),
    };
    await runSet({ ...use, DB: db.db }, setId, attempt, turn, step, clock);
    ran.push({ id: `${setId}-a${attempt}-t${turn}`, requests: sent.length - before, queries: db.queries() });
  }
}

// ---- A finished list to send rows from ----

type Line = { name: string; address?: string; door?: string; namesIt?: boolean; verdict?: string; rule?: number };

async function doneList(lines: Line[]): Promise<string> {
  const csv = ["Company,Website", ...lines.map((l) => `${l.name},${l.address ?? ""}`)].join("\n");
  const made = await createList(env, { csv }, "mine", clock(), async () => undefined);
  if (!made.ok) throw new Error(made.code);
  for (const [n, l] of lines.entries()) {
    const address = l.address ? `https://${l.address}/` : null;
    const door = l.address ? JSON.stringify({ kind: l.door ?? "gone", asked: address, finalUrl: address, toHost: null, namesIt: l.namesIt ?? null, title: null, chars: 0, serverDate: null, jobsLink: null, signupLink: null, error: null, knocks: 2 }) : null;
    await env.DB.prepare("UPDATE rows SET door = COALESCE(?3, door), reads = '[]', verdict = ?4, rule = ?5, why = 'as the free signs left it', checked_on = '2026-11-12' WHERE list_id = ?1 AND n = ?2")
      .bind(made.id, n, door, l.verdict ?? "could not tell", l.rule ?? 9)
      .run();
  }
  await env.DB.prepare("UPDATE lists SET status = 'done', finished_at = ?2, moved_at = ?2 WHERE id = ?1").bind(made.id, clock().toISOString()).run();
  return made.id;
}

const start = (use: typeof env = PAYING) => (listId: string, ask: WaveAsk = {}) => startWave(use, listId, ask, clock(), async (setId) => enqueue(setId, 0, 0));
const all = (id: string): Promise<FullRow[]> => listRows(env.DB, id, { from: 0, count: 2000 });
const made = () => sent.filter((s) => s.method === "POST" && s.path === "/datasets").length;

const THREE: Line[] = [{ name: "Rdio", address: "rdio.com", door: "gone", verdict: "zombie", rule: 3 }, { name: "Wesabe" }, { name: "Path", address: "path.com", door: "error" }];
const RDIO = { company_name: "Rdio", website: "rdio.com", still_operates: false, outcome: "shut down (assets acquired by Pandora)", outcome_date: "2015-11-16", outcome_source: "https://variety.com/rdio-shuts", most_recent_activity_date: "2015-12-22", most_recent_activity_link: "https://variety.com/rdio-shuts" };
const WESABE = { company_name: "Wesabe", website: "", still_operates: true, outcome: "", outcome_date: "", outcome_source: "", most_recent_activity_date: "2026-09-30", most_recent_activity_link: "https://blog.wesabe.com/new" };

beforeEach(async () => {
  fetchMock.activate();
  for (const table of ["rows", "lists", "limits", "spend", "sets"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
  world();
  queue = [];
  seen = new Set();
  ran = [];
  slept = [];
  onceTwice = false;
});
afterEach(() => fetchMock.reset());

describe("a wave of one set", () => {
  it("fills the set once, refills once for a row that did not come back, reads the sources, decides again and books the wallet's fall", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO], [WESABE]];
    pages.set("https://variety.com/rdio-shuts", { title: "Rdio to shut down", text: "Rdio is shutting down. ".repeat(30) });
    pages.set("https://blog.wesabe.com/new", { title: "What is new at Wesabe", text: "Wesabe shipped a release. ".repeat(30) });

    const started = await start()(id);
    expect(started).toMatchObject({ ok: true, rows: [1, 0, 2], costAtMost: 0.3 });
    if (!started.ok) return;
    await drive();

    expect(made()).toBe(1);
    expect(posts).toBe(2);
    expect([...datasets.values()][0]?.spec.description).toContain("Wesabe (no website known); Rdio (rdio.com); Path (path.com)");
    const rows = await all(id);
    expect(rows[0]).toMatchObject({ verdict: "zombie", rule: 1, lastSeen: "2015-12-22", lastSeenFrom: "from TinySet's source" });
    expect(rows[0]?.why).toContain("TinySet found that it no longer operates: shut down (assets acquired by Pandora), on 16 Nov 2015");
    expect(rows[0]?.evidence[0]).toBe("https://variety.com/rdio-shuts");
    expect(rows[1]).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-09-30", lastSeenFrom: "from TinySet's source" });
    expect(rows[2]?.outside).toMatchObject({ returned: false });
    expect(rows[2]?.verdict).toBe("could not tell");
    expect((await getList(env.DB, id))?.wall).toBe("zau");

    const set = await getSet(env.DB, started.setId);
    expect(set).toMatchObject({ status: "booked", fills: 2, bookedUsd: 0.2 });
    expect(set?.outcome).toEqual({ matched: 2, offList: [], wrongSite: [], missing: [2] });
    expect((await totals(env.DB)).spend_usd).toBe(0.2);
    // The wallet is read ten minutes after the last fill ended, because a charge can land late.
    expect(slept.some((s) => s.name.startsWith("wait for the charge") && s.ms >= 590_000)).toBe(true);
    for (const leg of ran) {
      expect(leg.requests, leg.id).toBeLessThanOrEqual(18);
      expect(leg.queries, leg.id).toBeLessThanOrEqual(40);
    }
  });

  it("throws away a company that is not on the list and a listed name on another site, and says how many", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO, { company_name: "Spotify", website: "spotify.com", still_operates: true }, { company_name: "Path", website: "path.fm", still_operates: true }], []];
    pages.set("https://variety.com/rdio-shuts", { text: "Rdio is shutting down. ".repeat(30) });
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive();
    const set = await getSet(env.DB, started.setId);
    expect(set?.outcome).toEqual({ matched: 1, offList: ["Spotify"], wrongSite: ["Path (path.fm, sent path.com)"], missing: [1, 2] });
    expect((await all(id))[2]?.outside).toMatchObject({ returned: false });
  });

  it("does not count a source that could not be read, or one that does not name the company", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO, { ...WESABE, most_recent_activity_link: "https://news.example.com/other" }, { company_name: "Path", website: "path.com", still_operates: false, outcome: "shut down", outcome_source: "https://dead.example.com/path" }]];
    pages.set("https://variety.com/rdio-shuts", { title: "A story", text: "A music service is shutting down. ".repeat(30) });
    pages.set("https://news.example.com/other", { text: "Nothing about that company here. ".repeat(30) });
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive();
    const rows = await all(id);
    // Rdio's door is gone, so it stays a zombie by that rule; what TinySet said is shown and decides nothing.
    expect(rows[0]).toMatchObject({ verdict: "zombie", rule: 3 });
    expect(rows[1]).toMatchObject({ verdict: "could not tell", rule: 9 });
    expect(rows[1]?.why).toContain("none of TinySet's sources could be read today");
    expect(rows[2]).toMatchObject({ verdict: "could not tell", rule: 9 });
    expect(posts).toBe(1);
  });
});

describe("a fill is never paid for twice", () => {
  it("asks for no second fill when the first was started and its answer was lost", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO, WESABE, { company_name: "Path", website: "path.com", still_operates: true }]];
    postMode = "answer lost";
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive();
    expect(posts).toBe(1);
    expect((await getSet(env.DB, started.setId))?.status).toBe("booked");
    expect((await all(id))[1]?.outside).toMatchObject({ returned: true, operates: true });
  });

  it("asks for one fill and one refill even when the step that asks is run twice", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO], [WESABE], [{ company_name: "Path", website: "path.com", still_operates: true }]];
    onceTwice = true;
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive();
    expect(posts).toBe(2);
    expect((await getSet(env.DB, started.setId))?.bookedUsd).toBe(0.2);
  });

  it("gives the rows back and books nothing when the fill never started", async () => {
    const id = await doneList(THREE);
    postMode = "refused";
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive();
    expect(posts).toBe(0);
    const set = await getSet(env.DB, started.setId);
    expect(set?.status).toBe("failed");
    expect(set?.note).toContain("Nothing was charged");
    expect((await totals(env.DB)).spend_usd).toBe(0);
    const taken = await env.DB.prepare("SELECT COUNT(*) AS n FROM rows WHERE list_id = ? AND set_id IS NOT NULL").bind(id).first<{ n: number }>();
    expect(taken?.n).toBe(0);
    expect((await all(id)).map((r) => r.outside)).toEqual([null, null, null]);
  });

  it("reads the set again after Carry on, and asks for no fill again", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO, WESABE, { company_name: "Path", website: "path.com", still_operates: true }]];
    looksToFill = 30;
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive(PAYING, 1);
    expect(posts).toBe(1);
    // The run dies here: what it queued is lost. Carry on starts a run of a new attempt.
    queue = [];
    expect(await carryOnSet(PAYING, started.setId, clock(), async (setId, attempt) => enqueue(setId, attempt, 0))).toBe("started");
    await drive();
    expect(posts).toBe(1);
    expect(made()).toBe(1);
    expect((await getSet(env.DB, started.setId))?.status).toBe("booked");
    // A run of the old attempt that wakes up later does nothing.
    const before = sent.length;
    queue.push({ setId: started.setId, attempt: 0, turn: 9 });
    await drive();
    expect(sent.length).toBe(before);
  });

  it("stops a fill that is not ready after forty looks, and takes what came", async () => {
    const id = await doneList(THREE);
    stuck = true;
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    await drive();
    expect(cancels).toBe(1);
    expect(posts).toBe(1);
    const set = await getSet(env.DB, started.setId);
    expect(set?.status).toBe("booked");
    // One read before the fill was asked for, and forty looks after it.
    expect(sent.filter((s) => s.method === "GET" && /^\/datasets\/ds-1$/.test(s.path)).length).toBe(41);
    for (const leg of ran) expect(leg.requests, leg.id).toBeLessThanOrEqual(18);
  });
});

describe("what a wave may cost", () => {
  it("starts nothing while the cap leaves no room beyond the two dollars kept for pages", async () => {
    const id = await doneList(THREE);
    expect(await start(env)(id)).toMatchObject({ ok: false, status: 402, code: "cap" });
    expect(await start({ ...env, SPEND_CAP_USD: "2" })(id)).toMatchObject({ ok: false, status: 402, code: "cap" });
    expect(await start({ ...env, SPEND_CAP_USD: "2.2" })(id)).toMatchObject({ ok: false, code: "cap" });
    expect(await start({ ...env, SPEND_CAP_USD: "2.3" })(id)).toMatchObject({ ok: true });
    expect(sent.filter((s) => s.path.startsWith("/datasets")).length).toBe(0);
  });

  it("counts what earlier sets cost, and starts no set while another is not in the books", async () => {
    const id = await doneList([...THREE, { name: "Vine", address: "vine.co" }, { name: "Jawbone", address: "jawbone.com" }]);
    await env.DB.prepare("INSERT INTO spend (at, kind, amount_usd, ref) VALUES ('2026-11-12T00:00:00Z', 'set', 17.6, 'earlier')").run();
    // 20 less 2 for pages less 17.60 leaves 40 cents: four rows, not five.
    expect(await start()(id)).toMatchObject({ ok: false, code: "cap" });
    expect(await start()(id, { count: 4 })).toMatchObject({ ok: true });
    queue = [];
    // Until that set is in the books nobody knows what it cost, so no other starts.
    await env.DB.prepare("UPDATE sets SET status = 'read'").run();
    expect(await start()(id, { count: 1 })).toMatchObject({ ok: false, status: 409, code: "set_in_flight" });
    await env.DB.prepare("UPDATE sets SET status = 'booked', booked_usd = 0.4").run();
    await env.DB.prepare("INSERT INTO spend (at, kind, amount_usd, ref) VALUES ('2026-11-12T01:00:00Z', 'set', 0.4, 'that one')").run();
    expect(await start()(id, { count: 1 })).toMatchObject({ ok: false, code: "cap" });
  });

  it("starts nothing when the wallet cannot be read, or holds less than the set may cost", async () => {
    const id = await doneList(THREE);
    walletDown = true;
    expect(await start()(id)).toMatchObject({ ok: false, status: 503, code: "wallet_unreadable" });
    walletDown = false;
    wallet = 0.2;
    expect(await start()(id)).toMatchObject({ ok: false, status: 402, code: "wallet_low" });
    expect(made()).toBe(0);
    const taken = await env.DB.prepare("SELECT COUNT(*) AS n FROM rows WHERE set_id IS NOT NULL").first<{ n: number }>();
    expect(taken?.n).toBe(0);
  });

  it("starts nothing for a list that is still being checked, while another set is being filled, or when no row is left to send", async () => {
    const id = await doneList(THREE);
    await env.DB.prepare("UPDATE lists SET status = 'working' WHERE id = ?").bind(id).run();
    expect(await start()(id)).toMatchObject({ ok: false, status: 409, code: "list_not_done" });
    await env.DB.prepare("UPDATE lists SET status = 'done' WHERE id = ?").bind(id).run();
    expect(await start()(id, { count: 2 })).toMatchObject({ ok: true, rows: [1, 0] });
    expect(await start()(id)).toMatchObject({ ok: false, status: 409, code: "set_in_flight" });
    await env.DB.prepare("UPDATE sets SET status = 'booked'").run();
    expect(await start()(id)).toMatchObject({ ok: true, rows: [2] });
    await env.DB.prepare("UPDATE sets SET status = 'booked'").run();
    expect(await start()(id)).toMatchObject({ ok: false, status: 409, code: "nothing_to_send" });
    expect(await start()("nosuchlist")).toMatchObject({ ok: false, status: 404 });
  });

  it("books the rows at ten cents each when the wallet cannot say, and never more than that", async () => {
    const id = await doneList(THREE);
    // One row comes back, so the wallet falls by ten cents; but the wallet cannot be read afterwards.
    fills = [[RDIO], []];
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    walletDown = true;
    await drive();
    expect((await getSet(env.DB, started.setId))?.bookedUsd).toBe(0.3);

    // Something else took money from the same wallet meanwhile: the set is still booked at no more than its rows.
    const other = await doneList([{ name: "Vine", address: "vine.co" }]);
    walletDown = false;
    fills = [[{ company_name: "Vine", website: "vine.co", still_operates: false }]];
    const second = await start()(other);
    if (!second.ok) throw new Error(second.code);
    wallet -= 5;
    await drive();
    expect((await getSet(env.DB, second.setId))?.bookedUsd).toBe(0.1);
  });

  it("reads the wallet a second time before it gives up on it", async () => {
    const id = await doneList(THREE);
    fills = [[RDIO], []];
    const started = await start()(id);
    if (!started.ok) throw new Error(started.code);
    walletFails = 1;
    await drive();
    expect((await getSet(env.DB, started.setId))?.bookedUsd).toBe(0.1);
  });

  it("starts nothing for a list whose free signs were read on another day", async () => {
    const id = await doneList(THREE);
    await env.DB.prepare("UPDATE lists SET finished_at = '2026-11-11T23:59:00.000Z' WHERE id = ?").bind(id).run();
    expect(await start()(id)).toMatchObject({ ok: false, status: 409, code: "list_from_another_day" });
    expect(made()).toBe(0);
  });

  it("starts with the rows I name, and gives the rows back when the run cannot be started", async () => {
    const id = await doneList(THREE);
    const refused = await startWave(PAYING, id, { rows: [2, 0] }, clock(), async () => {
      throw new Error("no workflow");
    });
    expect(refused).toMatchObject({ ok: false, status: 503, code: "could_not_start" });
    const taken = await env.DB.prepare("SELECT COUNT(*) AS n FROM rows WHERE set_id IS NOT NULL").first<{ n: number }>();
    expect(taken?.n).toBe(0);
    expect(await start()(id, { rows: [2, 0] })).toMatchObject({ ok: true, rows: [2, 0], costAtMost: 0.2 });
  });
});
