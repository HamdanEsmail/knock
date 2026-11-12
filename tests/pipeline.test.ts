import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FREE_READS_PER_DAY, SEARCHES_PER_MINUTE } from "../src/core/limits";
import { carryOn } from "../src/list/carry";
import { createList } from "../src/list/create";
import { FIRST_LEG, runLeg, type Leg, type ListStep } from "../src/list/run";
import { getList, listRows, type FullRow } from "../src/list/store";
import { legId } from "../src/list/workflow";
import { counted } from "./helpers/count-db";
import { fetchMock } from "./helpers/fetch-mock";

const FETCH = "https://api.fetch.tinyfish.ai";
const SEARCH = /^https:\/\/api\.search\.tinyfish\.ai\//;
const START = Date.parse("2026-11-12T08:00:00.000Z");
const TEXT = "Welcome to our product. It does many useful things for teams. ".repeat(12);

// ---- A stand-in world: pages, what Search lists, and a clock that only moves when told ----

type Page = { final_url?: string; title?: string; text?: string; links?: string[]; published_date?: string; last_modified?: string } | { error: string };
type Listed = { url: string; title: string; snippet?: string; date?: string };
type Sent = { kind: "fetch" | "search"; at: number; urls: string[]; ask: string };

let pages: Map<string, Page>;
let hits: Map<string, { "12"?: Listed[]; "36"?: Listed[]; any?: Listed[] }>;
/** Hosts whose searches are refused, and how many more times. */
let refusals: Map<string, number>;
/** The status a whole Fetch call fails with, or null when it is answered. */
let failCall: (urls: string[]) => number | null;
let sent: Sent[];
let nowMs: number;
const clock = () => new Date(nowMs);

function world() {
  pages = new Map();
  hits = new Map();
  refusals = new Map();
  failCall = () => null;
  sent = [];
  nowMs = START;
  fetchMock.intercept({
    method: "POST",
    url: FETCH,
    times: Infinity,
    reply: (_req, body) => {
      const urls = (body as { urls: string[] }).urls;
      sent.push({ kind: "fetch", at: nowMs, urls, ask: urls.join(" ") });
      const status = failCall(urls);
      if (status !== null) return new Response(JSON.stringify({ error: { code: "INVALID_INPUT" } }), { status });
      const results: unknown[] = [];
      const errors: unknown[] = [];
      for (const url of urls) {
        const page = pages.get(url);
        if (page === undefined) errors.push({ url, error: "target_http_error" });
        else if ("error" in page) errors.push({ url, error: page.error });
        else results.push({ url, final_url: page.final_url ?? url, title: page.title ?? "A page", text: page.text ?? TEXT, links: page.links ?? [], published_date: page.published_date, last_modified: page.last_modified });
      }
      return Response.json({ results, errors });
    },
  });
  fetchMock.intercept({
    method: "GET",
    url: SEARCH,
    times: Infinity,
    reply: (req) => {
      const p = new URL(req.url).searchParams;
      const host = p.get("include_domains") ?? "";
      const window = p.get("after_date") ? (p.get("before_date") ? "36" : "12") : "any";
      sent.push({ kind: "search", at: nowMs, urls: [], ask: `${host} ${window} ${p.get("query")}` });
      const left = refusals.get(host) ?? 0;
      if (left > 0) {
        refusals.set(host, left - 1);
        return new Response("{}", { status: 500 });
      }
      return Response.json({ results: hits.get(host)?.[window] ?? [] });
    },
  });
}

// ---- A stand-in Workflow: it runs legs one after another and refuses an id it has seen ----

type Queued = { attempt: number; leg: Leg };
type Ran = { id: string; requests: number; queries: number };

let queue: Queued[];
let seen: Set<string>;
let ran: Ran[];
/** Called at every sleep, so a test can look at the list while it waits. */
let onSleep: (name: string, ms: number) => Promise<void>;
/** How a step runs its work: once, with one more try when it throws, as the real one does. */
let attemptStep: <T>(name: string, fn: () => Promise<T>) => Promise<T>;

const once = async <T>(_name: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fn();
  }
};

function enqueue(listId: string, attempt: number, leg: Leg) {
  const id = legId(listId, attempt, leg);
  if (seen.has(id)) throw new Error(`a run with the id ${id} exists already`);
  seen.add(id);
  queue.push({ attempt, leg });
}

/** Runs queued legs until none is left, or `max` have run. */
async function drive(listId: string, max = Infinity): Promise<void> {
  for (let n = 0; n < max && queue.length > 0; n++) {
    const { attempt, leg } = queue.shift()!;
    const db = counted(env.DB);
    const before = sent.length;
    const step: ListStep = {
      do: (name, fn) => {
        nowMs += 1000;
        return attemptStep(name, fn);
      },
      sleep: async (name, ms) => {
        await onSleep(name, ms);
        nowMs += ms;
      },
      handOver: async (next) => enqueue(listId, attempt, next),
    };
    await runLeg({ ...env, DB: db.db }, listId, attempt, leg, step, clock);
    ran.push({ id: legId(listId, attempt, leg), requests: sent.length - before, queries: db.queries() });
  }
}

async function newList(csv: string): Promise<string> {
  const made = await createList(env, { csv }, "mine", clock(), async (id) => enqueue(id, 0, FIRST_LEG));
  if (!made.ok) throw new Error(made.code);
  return made.id;
}

const all = (id: string): Promise<FullRow[]> => listRows(env.DB, id, { from: 0, count: 2000 });
const fetchesOf = (url: string): number => sent.filter((s) => s.kind === "fetch" && s.urls.includes(url)).length;

beforeEach(async () => {
  fetchMock.activate();
  for (const table of ["rows", "lists", "limits", "spend"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
  queue = [];
  seen = new Set();
  ran = [];
  onSleep = async () => undefined;
  attemptStep = once;
  world();
});
afterEach(() => fetchMock.reset());

// ---- Nine kinds of company, in turn ----

const home = (i: number) => `https://nimbus${i}.com/`;

/** Puts company `i` into the world as one of nine kinds, and gives its line of the sheet. */
function company(i: number): string {
  const host = `nimbus${i}.com`;
  const kind = i % 9;
  if (kind === 0) {
    // Answers, with a new page, a jobs page and a sign-up page.
    pages.set(home(i), { title: `Nimbus${i}`, links: [`https://${host}/careers`, `https://${host}/signup`, `https://${host}/blog/new`] });
    pages.set(`https://${host}/careers`, {});
    pages.set(`https://${host}/signup`, {});
    pages.set(`https://${host}/blog/new`, { published_date: "2026-10-01T09:00:00.000Z" });
    hits.set(host, { "12": [{ url: `https://${host}/blog/new`, title: "News", date: "2026-10-01" }] });
  } else if (kind === 1) {
    // Answers; its newest page is two years old.
    pages.set(home(i), {});
    pages.set(`https://${host}/blog/old`, { published_date: "2024-12-01T09:00:00.000Z" });
    hits.set(host, { "36": [{ url: `https://${host}/blog/old`, title: "Older news", date: "2024-12-01" }] });
  } else if (kind === 2) {
    // Answers; nothing newer than 2019.
    pages.set(home(i), {});
    pages.set(`https://${host}/blog/first`, { published_date: "2019-03-01T09:00:00.000Z" });
    hits.set(host, { any: [{ url: `https://${host}/blog/first`, title: "Hello", date: "2019-03-01" }] });
  } else if (kind === 3) {
    pages.set(home(i), { error: "invalid_url" });
  } else if (kind === 4) {
    // An error under https; under http it answers and has a sign-up page.
    pages.set(home(i), { error: "target_http_error" });
    pages.set(`http://${host}/`, { links: [`http://${host}/signup`] });
    pages.set(`http://${host}/signup`, {});
  } else if (kind === 5) {
    pages.set(home(i), { final_url: "https://buyer.com/products", title: "Buyer products" });
  } else if (kind === 6) {
    pages.set(home(i), { text: `This domain is for sale. Buy this domain today. ${TEXT}` });
  } else if (kind === 8) {
    pages.set(home(i), { error: "bot_blocked" });
  }
  return `Nimbus${i},${kind === 7 ? "n/a" : host}`;
}

const sheet = (n: number): string => ["name,url", ...Array.from({ length: n }, (_, i) => company(i))].join("\n");

describe("a list worked from start to finish", () => {
  it("gives every one of 90 rows a verdict, with its reason, its date and its links", async () => {
    const id = await newList(sheet(90));
    await drive(id);

    const list = await getList(env.DB, id);
    expect(list).toMatchObject({ status: "done", note: "", wakeAt: null });
    expect(list?.finishedAt).not.toBeNull();
    expect(list?.wall).toHaveLength(90);
    expect(list?.wall).not.toContain(".");

    const rows = await all(id);
    const tally: Record<string, number> = {};
    for (const r of rows) tally[r.verdict ?? "none"] = (tally[r.verdict ?? "none"] ?? 0) + 1;
    expect(tally).toEqual({ alive: 10, "slowing down": 20, zombie: 40, "could not tell": 20 });
    for (const r of rows) {
      expect(r.why, `row ${r.n}`).toBeTruthy();
      expect(r.checkedOn).toBe("2026-11-12");
    }

    // One of each kind, as the sheet will show it.
    expect(rows[0]).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-10-01", lastSeenFrom: "the page's own date" });
    expect(rows[0]?.evidence[0]).toBe("https://nimbus0.com/blog/new");
    expect(rows[0]?.reads?.map((r) => [r.kind, r.ok])).toEqual([["hit", true], ["jobs", true], ["signup", true]]);
    expect(rows[1]).toMatchObject({ verdict: "slowing down", rule: 6, lastSeen: "2024-12-01" });
    expect(rows[2]).toMatchObject({ verdict: "zombie", rule: 7, lastSeen: "2019-03-01" });
    expect(rows[3]).toMatchObject({ verdict: "zombie", rule: 3, door: { kind: "gone", knocks: 2 } });
    expect(rows[3]?.why).toContain("It was asked twice.");
    expect(rows[4]).toMatchObject({ verdict: "slowing down", rule: 6, door: { kind: "answers", knocks: 2, finalUrl: "http://nimbus4.com/" } });
    expect(rows[4]?.why).toContain("its sign-up page is there");
    expect(rows[5]).toMatchObject({ verdict: "zombie", rule: 4, door: { kind: "forwards", toHost: "buyer.com", namesIt: false } });
    expect(rows[6]).toMatchObject({ verdict: "zombie", rule: 2, door: { kind: "for_sale" } });
    expect(rows[7]).toMatchObject({ verdict: "could not tell", rule: 9, door: { kind: "no_address" }, pages: null });
    expect(rows[8]).toMatchObject({ verdict: "could not tell", rule: 9, door: { kind: "blocked", knocks: 1 } });

    // A door that blocks readers is not knocked on twice; one that answered is asked once.
    expect(fetchesOf(home(8))).toBe(1);
    expect(fetchesOf(home(0))).toBe(1);
    expect(fetchesOf(home(3))).toBe(2);
  });

  it("stays inside the free plan in every leg: outside requests and database queries", async () => {
    const id = await newList(sheet(90));
    await drive(id);
    expect(ran.length).toBeGreaterThan(5);
    for (const leg of ran) {
      expect(leg.requests, `${leg.id} requests`).toBeLessThanOrEqual(18);
      expect(leg.queries, `${leg.id} queries`).toBeLessThanOrEqual(40);
    }
  });

  it("stays under 40 outside requests a leg when every step that calls out is tried twice", async () => {
    attemptStep = async (name, fn) => {
      if (/^(knock|read|ask) /.test(name)) await fn().catch(() => undefined);
      return fn();
    };
    const id = await newList(sheet(45));
    await drive(id);
    expect((await getList(env.DB, id))?.status).toBe("done");
    for (const leg of ran) expect(leg.requests, `${leg.id} requests`).toBeLessThan(40);
  });

  it("asks Search no more than seven times in any minute", async () => {
    const id = await newList(sheet(45));
    await drive(id);
    const perMinute = new Map<number, number>();
    for (const s of sent) if (s.kind === "search") perMinute.set(Math.floor(s.at / 60_000), (perMinute.get(Math.floor(s.at / 60_000)) ?? 0) + 1);
    expect(perMinute.size).toBeGreaterThan(3);
    for (const [minute, n] of perMinute) expect(n, `minute ${minute}`).toBeLessThanOrEqual(SEARCHES_PER_MINUTE);
  });

  it("asks the windows in order and stops at the first that has a dated page", async () => {
    const id = await newList(sheet(3));
    await drive(id);
    const asked = (host: string) => sent.filter((s) => s.kind === "search" && s.ask.startsWith(`${host} `)).map((s) => s.ask.split(" ")[1]);
    expect(asked("nimbus0.com")).toEqual(["12"]);
    expect(asked("nimbus1.com")).toEqual(["12", "36"]);
    expect(asked("nimbus2.com")).toEqual(["12", "36", "any"]);
    expect(sent.find((s) => s.kind === "search")?.ask).toBe("nimbus0.com 12 Nimbus0");
  });
});

describe("a call that fails is not a sign", () => {
  it("asks a refused search again, and after three refusals says Search could not be asked", async () => {
    pages.set("https://once.com/", {});
    pages.set("https://never.com/", {});
    hits.set("once.com", { "12": [{ url: "https://once.com/news", title: "News", date: "2026-09-09" }] });
    pages.set("https://once.com/news", { published_date: "2026-09-09T00:00:00Z" });
    refusals.set("once.com", 1);
    refusals.set("never.com", 99);
    const id = await newList("name,url\nOnce,once.com\nNever,never.com\n");
    await drive(id);

    const [once_, never] = await all(id);
    expect(once_).toMatchObject({ verdict: "alive", pagesTries: 1, pages: { done: true, failed: null, found: "12" } });
    expect(never).toMatchObject({ verdict: "could not tell", pagesTries: 3, pages: { done: true, failed: "http_500", found: null } });
    expect(never?.why).toContain("Search could not be asked.");
    expect(sent.filter((s) => s.kind === "search" && s.ask.startsWith("never.com ")).length).toBe(3);
  });

  it("lets one bad address cost one row: after a call fails as a whole, its rows are asked alone", async () => {
    for (const name of ["a", "b", "c", "d"]) pages.set(`https://${name}good.com/`, {});
    failCall = (urls) => (urls.includes("https://poison.com/") ? 400 : null);
    const id = await newList("name,url\nA,agood.com\nB,bgood.com\nPoison,poison.com\nC,cgood.com\nD,dgood.com\n");
    await drive(id);

    const rows = await all(id);
    expect(rows.map((r) => r.door?.kind)).toEqual(["answers", "answers", "not_asked", "answers", "answers"]);
    // Three tries at the door, and one more when the doors that failed are knocked on again.
    expect(rows[2]).toMatchObject({ verdict: "could not tell", doorTries: 4, door: { error: "INVALID_INPUT", knocks: 1 } });
    expect(rows[2]?.why).toContain("could not be asked");
    // The first call held all five; after it failed, each was asked by itself.
    const calls = sent.filter((s) => s.kind === "fetch" && s.urls.some((u) => /good|poison/.test(u)) && !s.urls.some((u) => u.startsWith("http://")));
    expect(calls[0]?.urls).toHaveLength(5);
    for (const call of calls.slice(1)) expect(call.urls).toHaveLength(1);
    expect(fetchesOf("https://poison.com/")).toBe(4);
    for (const good of ["a", "b", "c", "d"]) expect(fetchesOf(`https://${good}good.com/`)).toBe(2);
  });

  it("carries on when a step still fails after its second try, and counts a try for its rows", async () => {
    for (const name of ["a", "b", "c"]) pages.set(`https://${name}good.com/`, {});
    let failures = 0;
    attemptStep = async (name, fn) => {
      if (name.startsWith("knock") && failures < 2) {
        failures++;
        throw new Error("the step broke");
      }
      return once(name, fn);
    };
    const id = await newList("name,url\nA,agood.com\nB,bgood.com\nC,cgood.com\n");
    await drive(id);
    const rows = await all(id);
    expect(rows.map((r) => r.door?.kind)).toEqual(["answers", "answers", "answers"]);
    // The call of three broke; then each was asked alone, and the first of those broke once more.
    expect(rows.map((r) => r.doorTries)).toEqual([3, 2, 2]);
    expect((await getList(env.DB, id))?.status).toBe("done");
  });

  it("does not take an address that came back neither read nor refused as an answer", async () => {
    // Fetch answers the call but leaves this address out of it, three times.
    pages.set("https://quiet.com/", {});
    const real = pages.get.bind(pages);
    fetchMock.reset();
    fetchMock.activate();
    fetchMock.intercept({ method: "POST", url: FETCH, times: Infinity, reply: (_req, body) => (sent.push({ kind: "fetch", at: nowMs, urls: (body as { urls: string[] }).urls, ask: "" }), Response.json({ results: [], errors: [] })) });
    fetchMock.intercept({ method: "GET", url: SEARCH, times: Infinity, reply: { json: { results: [] } } });
    expect(real("https://quiet.com/")).toBeDefined();
    const id = await newList("name,url\nQuiet,quiet.com\n");
    await drive(id);
    const [row] = await all(id);
    expect(row).toMatchObject({ doorTries: 4, door: { kind: "not_asked", error: "not_answered", knocks: 1 }, verdict: "could not tell" });
  });
});

describe("a second knock", () => {
  it("follows a company to its new address and asks for new pages there, by name", async () => {
    pages.set("https://oldhome.com/", { error: "target_http_error" });
    pages.set("http://oldhome.com/", { final_url: "https://newhome.com/zephyr", title: "Zephyr is now part of Newhome" });
    hits.set("newhome.com", {
      "12": [
        { url: "https://newhome.com/blog/zephyr-update", title: "Zephyr update", date: "2026-08-20" },
        { url: "https://newhome.com/blog/other", title: "Something else entirely", date: "2026-11-01" },
      ],
    });
    pages.set("https://newhome.com/blog/zephyr-update", { published_date: "2026-08-20T00:00:00Z" });
    const id = await newList("name,url\nZephyr,oldhome.com\n");
    await drive(id);

    const [row] = await all(id);
    expect(row).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-08-20", door: { kind: "forwards", toHost: "newhome.com", namesIt: true, knocks: 2 }, pages: { host: "newhome.com", found: "12", count: 1 } });
    expect(row?.why).toContain("The address now leads to newhome.com, which names it.");
    // Its old address was asked first, as every row's is.
    const hosts = sent.filter((s) => s.kind === "search").map((s) => s.ask.split(" ")[0]);
    expect(hosts.slice(0, 3)).toEqual(["oldhome.com", "oldhome.com", "oldhome.com"]);
    expect(hosts.at(-1)).toBe("newhome.com");
  });

  it("reads the next page too when the newest one's own date is outside the window it was found in", async () => {
    pages.set("https://drift.com/", {});
    hits.set("drift.com", {
      "12": [
        { url: "https://drift.com/about", title: "About", date: "2026-10-10" },
        { url: "https://drift.com/blog/launch", title: "Launch", date: "2026-02-02" },
      ],
    });
    // The index dates the page October 2026; the page itself says 2018.
    pages.set("https://drift.com/about", { published_date: "2018-01-05T00:00:00Z" });
    pages.set("https://drift.com/blog/launch", { published_date: "2026-02-02T00:00:00Z" });
    const id = await newList("name,url\nDrift,drift.com\n");
    await drive(id);
    const [row] = await all(id);
    expect(row?.reads?.map((r) => [r.kind, r.ok, r.pageDate])).toEqual([["hit", true, "2018-01-05"], ["hit2", true, "2026-02-02"]]);
    expect(row).toMatchObject({ verdict: "alive", lastSeen: "2026-02-02", lastSeenFrom: "the page's own date" });
  });
});

describe("a newest page that cannot be used", () => {
  it("reads the next page when the newest one leads off the company's site", async () => {
    pages.set("https://bigco.com/", {});
    hits.set("bigco.com", {
      "12": [
        { url: "https://bigco.com/system-status/", title: "Status", date: "2026-11-12" },
        { url: "https://bigco.com/blog/launch", title: "Launch", date: "2026-06-01" },
      ],
    });
    pages.set("https://bigco.com/system-status/", { final_url: "https://www.bigcostatus.com/", published_date: "2026-11-12T00:00:00Z" });
    pages.set("https://bigco.com/blog/launch", { published_date: "2026-06-01T00:00:00Z" });
    const id = await newList("name,url\nBigco,bigco.com\n");
    await drive(id);
    const [row] = await all(id);
    expect(row?.reads?.map((r) => [r.kind, r.ok])).toEqual([["hit", true], ["hit2", true]]);
    expect(row).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-06-01", lastSeenFrom: "the page's own date" });
    expect(row?.evidence[0]).toBe("https://bigco.com/blog/launch");
  });

  it("reads the next page when the newest one could not be read", async () => {
    pages.set("https://smallco.com/", {});
    hits.set("smallco.com", {
      "12": [
        { url: "https://smallco.com/gone-page", title: "Gone", date: "2026-10-10" },
        { url: "https://smallco.com/news", title: "News", date: "2026-04-04" },
      ],
    });
    pages.set("https://smallco.com/gone-page", { error: "page_not_found" });
    pages.set("https://smallco.com/news", {});
    const id = await newList("name,url\nSmallco,smallco.com\n");
    await drive(id);
    const [row] = await all(id);
    expect(row?.reads?.map((r) => [r.kind, r.ok])).toEqual([["hit", false], ["hit2", true]]);
    expect(row).toMatchObject({ verdict: "alive", lastSeen: "2026-04-04", lastSeenFrom: "date from search" });
  });
});

describe("stopping and carrying on", () => {
  it("carries on where it stopped, only after ten quiet minutes, and an older run stops at once", async () => {
    const id = await newList(sheet(50));
    await drive(id, 3);
    expect(queue).toHaveLength(1);
    const stale = queue.shift()!;
    const doneBefore = (await all(id)).filter((r) => r.door !== null && r.door.kind !== "no_address").length;
    expect(doneBefore).toBeGreaterThan(0);

    const start = async (attempt: number, leg: Leg) => enqueue(id, attempt, leg);
    expect(await carryOn(env, id, clock(), start)).toBe("still working");
    expect(queue).toHaveLength(0);

    nowMs += 11 * 60_000;
    expect(await carryOn(env, id, clock(), start)).toBe("started");
    expect((await getList(env.DB, id))?.attempt).toBe(1);
    expect(queue).toEqual([{ attempt: 1, leg: { group: 0, stage: "doors", turn: 0 } }]);
    // Pressed twice: the list has just moved, so nothing more is started.
    expect(await carryOn(env, id, clock(), start)).toBe("still working");

    // The run of the older attempt wakes up, sees it is no longer the list's, and does nothing.
    const before = sent.length;
    queue.unshift(stale);
    await drive(id, 1);
    expect(sent.length).toBe(before);
    expect(queue).toHaveLength(1);

    await drive(id);
    const rows = await all(id);
    expect((await getList(env.DB, id))?.status).toBe("done");
    expect(rows.every((r) => r.verdict !== null)).toBe(true);
    // No door that had answered was knocked on again.
    for (const i of [0, 9, 18]) expect(fetchesOf(home(i)), `home ${i}`).toBe(1);
    expect(await carryOn(env, id, clock(), start)).toBe("done");
  });

  it("says a list is not there", async () => {
    expect(await carryOn(env, "nothere", clock(), async () => undefined)).toBe("not found");
  });
});

describe("the day's pages", () => {
  it("makes a list wait for midnight when the day's pages are read, says so, and carries on by itself", async () => {
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'reads', ?)").bind(FREE_READS_PER_DAY - 6).run();
    const id = await newList(sheet(18));
    const waits: { status?: string; note?: string; wakeAt?: string | null; ms: number }[] = [];
    onSleep = async (name, ms) => {
      if (!name.startsWith("wait for the day")) return;
      const list = await getList(env.DB, id);
      waits.push({ status: list?.status, note: list?.note, wakeAt: list?.wakeAt, ms });
      expect(await carryOn(env, id, new Date(nowMs + 30 * 60_000), async () => undefined)).toBe("waiting");
    };
    await drive(id);

    expect(waits.length).toBeGreaterThanOrEqual(1);
    expect(waits[0]).toMatchObject({ status: "waiting", wakeAt: "2026-11-13T00:00:05.000Z" });
    expect(waits[0]?.note).toMatch(/midnight UTC/);
    // No page was read on the 12th beyond the allowance.
    expect(await env.DB.prepare("SELECT count FROM limits WHERE day = '2026-11-12' AND name = 'reads'").first("count")).toBeLessThanOrEqual(FREE_READS_PER_DAY);
    const list = await getList(env.DB, id);
    expect(list).toMatchObject({ status: "done", wakeAt: null });
    expect((await all(id)).every((r) => r.verdict !== null)).toBe(true);
    expect(await env.DB.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM spend").first("usd")).toBe(0);
  });

  it("with a cap above nothing, reads on past the free pages and books what they cost", async () => {
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'reads', ?)").bind(FREE_READS_PER_DAY - 2).run();
    const id = await newList(sheet(3));
    const capped = { ...env, SPEND_CAP_USD: "20" };
    const db = counted(env.DB);
    const step: ListStep = { do: (name, fn) => once(name, fn), sleep: async () => undefined, handOver: async (next) => enqueue(id, 0, next) };
    while (queue.length > 0) await runLeg({ ...capped, DB: db.db }, id, 0, queue.shift()!.leg, step, clock);

    expect((await getList(env.DB, id))?.status).toBe("done");
    const read = Number(await env.DB.prepare("SELECT count FROM limits WHERE day = '2026-11-12' AND name = 'reads'").first("count"));
    expect(read).toBeGreaterThan(FREE_READS_PER_DAY);
    const usd = Number(await env.DB.prepare("SELECT COALESCE(SUM(amount_usd), 0) AS usd FROM spend WHERE kind = 'reads'").first("usd"));
    expect(usd).toBeCloseTo((read - FREE_READS_PER_DAY) * 0.001, 6);
  });
});
