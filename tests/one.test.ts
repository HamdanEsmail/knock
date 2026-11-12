import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FREE_READS_PER_DAY, KNOCKS_PER_DAY, KNOCKS_PER_VISITOR_PER_HOUR, SEARCHES_PER_MINUTE } from "../src/core/limits";
import { countOf } from "../src/list/store";
import { knockOnce } from "../src/one/knock";
import { fetchMock } from "./helpers/fetch-mock";

const FETCH = "https://api.fetch.tinyfish.ai";
const SEARCH = /^https:\/\/api\.search\.tinyfish\.ai\//;
const NOW = new Date("2026-11-12T10:20:30.000Z");
const TEXT = "Welcome to Acme. We make useful things for teams, and we are hiring. ".repeat(12);

type Page = { final_url?: string; title?: string; text?: string; links?: string[]; published_date?: string } | { error: string };
let pages: Map<string, Page>;
let hits: Map<string, { url: string; title: string; date?: string }[]>;
let sent: { kind: "fetch" | "search"; ask: string }[];

beforeEach(async () => {
  fetchMock.activate();
  for (const table of ["rows", "lists", "limits", "spend"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
  pages = new Map();
  hits = new Map();
  sent = [];
  fetchMock.intercept({
    method: "POST",
    url: FETCH,
    times: Infinity,
    reply: (_req, body) => {
      const urls = (body as { urls: string[] }).urls;
      sent.push({ kind: "fetch", ask: urls.join(" ") });
      const results: unknown[] = [];
      const errors: unknown[] = [];
      for (const url of urls) {
        const page = pages.get(url);
        if (page === undefined) errors.push({ url, error: "dns_resolution_failed" });
        else if ("error" in page) errors.push({ url, error: page.error });
        else results.push({ url, final_url: page.final_url ?? url, title: page.title ?? "Acme", text: page.text ?? TEXT, links: page.links ?? [], published_date: page.published_date });
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
      const window = p.get("after_date") ? (p.get("before_date") ? "36" : "12") : "any";
      sent.push({ kind: "search", ask: `${p.get("include_domains")} ${window}` });
      const found = window === "12" ? (hits.get(p.get("include_domains") ?? "") ?? []) : [];
      return Response.json({ results: found.map((h) => ({ url: h.url, title: h.title, snippet: "", date: h.date })) });
    },
  });
});
afterEach(() => fetchMock.reset());

const acme = () => {
  pages.set("https://acme.com/", { links: ["https://acme.com/careers", "https://acme.com/blog/new"] });
  pages.set("https://acme.com/careers", { title: "Careers at Acme" });
  pages.set("https://acme.com/blog/new", { title: "What is new", published_date: "2026-10-20T09:00:00.000Z" });
  hits.set("acme.com", [{ url: "https://acme.com/blog/new", title: "What is new", date: "2026-10-20" }]);
};

describe("knocking on one door", () => {
  it("knocks, looks for new pages, reads what it found and gives the verdict with its signs", async () => {
    acme();
    const got = await knockOnce(env, "acme.com", "visitor-1", NOW);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.row).toMatchObject({ name: "Acme", address: "https://acme.com/", verdict: "alive", rule: 5, lastSeen: "2026-10-20", lastSeenFrom: "the page's own date", checkedOn: "2026-11-12" });
    expect(got.row.door).toMatchObject({ kind: "answers", jobsLink: "https://acme.com/careers" });
    expect(got.row.evidence[0]).toBe("https://acme.com/blog/new");
    expect(got.searchBusy).toBe(false);
    // The door, then the newest page and the jobs page: three pages and one search, all counted.
    expect(await countOf(env.DB, "2026-11-12", "reads")).toBe(3);
    expect(await countOf(env.DB, "2026-11-12", "search")).toBe(1);
    // Nothing of it is kept as a list.
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM rows").first("n")).toBe(0);
  });

  it("says nobody is home when the address is for sale", async () => {
    pages.set("https://gone.io/", { final_url: "https://www.atom.com/name/gone", title: "gone.io is for sale", text: "This premium domain is for sale. Buy this domain today. ".repeat(10) });
    const got = await knockOnce(env, "https://gone.io", "visitor-1", NOW);
    expect(got.ok && got.row.verdict).toBe("zombie");
    expect(got.ok && got.row.rule).toBe(2);
  });

  it("asks nothing for something that is not a web address", async () => {
    for (const raw of ["", "not an address", "someone@example.com"]) expect(await knockOnce(env, raw, "visitor-1", NOW)).toMatchObject({ ok: false, status: 400, code: "bad_address" });
    expect(sent).toHaveLength(0);
  });

  it("takes ten knocks an hour from one visitor, and counts each visitor apart", async () => {
    acme();
    for (let i = 0; i < KNOCKS_PER_VISITOR_PER_HOUR; i++) expect((await knockOnce(env, "acme.com", "visitor-1", NOW)).ok).toBe(true);
    const before = sent.length;
    expect(await knockOnce(env, "acme.com", "visitor-1", NOW)).toMatchObject({ ok: false, status: 429, code: "too_many_knocks" });
    expect(sent.length).toBe(before);
    expect((await knockOnce(env, "acme.com", "visitor-2", NOW)).ok).toBe(true);
    expect((await knockOnce(env, "acme.com", "visitor-1", new Date("2026-11-12T11:00:01.000Z"))).ok).toBe(true);
    // A knock that was refused does not use up one of the day's.
    expect(await countOf(env.DB, "2026-11-12", "knocks")).toBe(KNOCKS_PER_VISITOR_PER_HOUR + 2);
  });

  it("stops for the day after three hundred knocks, and when the day's pages are read", async () => {
    acme();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'knocks', ?)").bind(KNOCKS_PER_DAY).run();
    expect(await knockOnce(env, "acme.com", "visitor-1", NOW)).toMatchObject({ ok: false, status: 429, code: "knocks_used" });
    await env.DB.prepare("DELETE FROM limits").run();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'reads', ?)").bind(FREE_READS_PER_DAY - 2).run();
    expect(await knockOnce(env, "acme.com", "visitor-1", NOW)).toMatchObject({ ok: false, status: 429, code: "pages_used" });
    expect(sent).toHaveLength(0);
  });

  it("still answers from the door when Search is taken up this minute, and says so", async () => {
    acme();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'search:10:20', ?)").bind(SEARCHES_PER_MINUTE + 1).run();
    const got = await knockOnce(env, "acme.com", "visitor-1", NOW);
    expect(got.ok && got.searchBusy).toBe(true);
    expect(got.ok && got.row.door?.kind).toBe("answers");
    expect(sent.filter((s) => s.kind === "search")).toHaveLength(0);
  });

  it("keeps one search a minute for a knock even while a list uses its seven", async () => {
    acme();
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-12', 'search:10:20', ?)").bind(SEARCHES_PER_MINUTE).run();
    const got = await knockOnce(env, "acme.com", "visitor-1", NOW);
    expect(got.ok && got.searchBusy).toBe(false);
    expect(got.ok && got.row.verdict).toBe("alive");
    expect(await countOf(env.DB, "2026-11-12", "search:10:20")).toBe(SEARCHES_PER_MINUTE + 1);
  });

  it("lets me knock without counting against a visitor's ten", async () => {
    acme();
    for (let i = 0; i < KNOCKS_PER_VISITOR_PER_HOUR + 2; i++) expect((await knockOnce(env, "acme.com", null, NOW)).ok).toBe(true);
  });
});
