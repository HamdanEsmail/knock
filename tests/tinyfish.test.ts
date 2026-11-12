import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { knock, readItems } from "../src/list/stages";
import { countOf, countReads, readsLeft } from "../src/list/store";
import { NOT_ANSWERED, readPages } from "../src/tinyfish/fetch";
import { searchSite } from "../src/tinyfish/search";
import { readBalance } from "../src/tinyfish/wallet";
import { fetchMock } from "./helpers/fetch-mock";

const FETCH = "https://api.fetch.tinyfish.ai";
const SEARCH = /^https:\/\/api\.search\.tinyfish\.ai\//;
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(async () => {
  fetchMock.activate();
  await env.DB.exec("DELETE FROM limits");
});
afterEach(() => fetchMock.reset());

describe("reading pages", () => {
  it("asks for live pages with their links and the server's date, and sends the key", async () => {
    fetchMock.intercept({
      method: "POST",
      url: FETCH,
      reply: (req) => {
        expect(req.headers.get("x-api-key")).toBe("test-tinyfish-key");
        return Response.json({ results: [], errors: [{ url: "https://acme.com/", error: "timeout" }] });
      },
    });
    await readPages(env, ["https://acme.com/"]);
    expect(fetchMock.calls[0]?.body).toEqual({ urls: ["https://acme.com/"], format: "markdown", links: true, ttl: 0, include_etag_and_last_modified: true, per_url_timeout_ms: 30000 });
  });

  it("gives one answer for each address, in the order asked", async () => {
    fetchMock.intercept({
      method: "POST",
      url: FETCH,
      reply: {
        json: {
          results: [
            { url: "https://b.com/", final_url: "https://www.b.com/home", title: "B", published_date: "2026-10-30T19:31:51.000Z", last_modified: "Sat, 03 Jan 2015 08:00:00 GMT", text: "x".repeat(25_000), links: ["https://b.com/jobs", 7, "https://b.com/pricing"] },
            { url: "https://d.com", final_url: "https://d.com/", title: "", text: "" },
          ],
          errors: [{ url: "https://a.com/", error: "invalid_url" }],
        },
      },
    });
    const got = await readPages(env, ["https://a.com/", "https://b.com/", "https://c.com/", "https://d.com/"]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.pages).toEqual([
      { url: "https://a.com/", ok: false, error: "invalid_url" },
      { url: "https://b.com/", ok: true, finalUrl: "https://www.b.com/home", title: "B", pageDate: "2026-10-30", serverDate: "2015-01-03", text: "x".repeat(20_000), chars: 25_000, links: ["https://b.com/jobs", "https://b.com/pricing"] },
      // Asked, and neither read nor refused: that is not an answer about the page.
      { url: "https://c.com/", ok: false, error: NOT_ANSWERED },
      // Matched whatever the last slash; a page without text is an empty page.
      { url: "https://d.com/", ok: false, error: "empty_content" },
    ]);
  });

  it("says the call failed when TinyFish refuses it or cannot be reached", async () => {
    fetchMock.intercept({ method: "POST", url: FETCH, reply: { status: 400, json: { error: { code: "invalid_request" } } } });
    expect(await readPages(env, ["https://a.com/"])).toEqual({ ok: false, error: "invalid_request" });
    fetchMock.intercept({ method: "POST", url: FETCH, reply: { status: 503, body: "busy" } });
    expect(await readPages(env, ["https://a.com/"])).toEqual({ ok: false, error: "http_503" });
    fetchMock.intercept({
      method: "POST",
      url: FETCH,
      reply: () => {
        throw new TypeError("connection lost");
      },
    });
    expect(await readPages(env, ["https://a.com/"])).toEqual({ ok: false, error: "network" });
    fetchMock.intercept({ method: "POST", url: FETCH, reply: { body: "<html>not json</html>" } });
    expect(await readPages(env, ["https://a.com/"])).toEqual({ ok: false, error: "bad_json" });
  });

  it("takes at most five addresses, and makes no call for none", async () => {
    await expect(readPages(env, ["1", "2", "3", "4", "5", "6"].map((n) => `https://${n}.com/`))).rejects.toThrow(RangeError);
    expect(await readPages(env, [])).toEqual({ ok: true, pages: [] });
    expect(fetchMock.calls).toHaveLength(0);
  });
});

describe("the reading allowance", () => {
  it("is 800 pages a day while nothing may be spent", async () => {
    expect(await readsLeft(env, today())).toBe(800);
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES (?, 'reads', 795)").bind(today()).run();
    expect(await readsLeft(env, today())).toBe(5);
  });

  it("goes down as the pages that were read are counted", async () => {
    await env.DB.batch([countReads(env.DB, today(), 3), countReads(env.DB, today(), 4)]);
    expect(await countOf(env.DB, today(), "reads")).toBe(7);
    expect(await readsLeft(env, today())).toBe(793);
  });

  it("counts a page TinyFish tried and could not read, and not one it gave no answer for", async () => {
    // TinyFish keeps a record of a page it tried and failed on, so that page is one of the day's.
    const reply = { json: { results: [{ url: "https://a.com/", final_url: "https://a.com/", title: "A", text: "x".repeat(900) }], errors: [{ url: "https://b.com/", error: "bot_blocked" }] } };
    fetchMock.intercept({ method: "POST", url: FETCH, reply });
    const doors = ["a", "b", "c"].map((s, n) => ({ n, name: s, address: `https://${s}.com/`, url: `https://${s}.com/`, tries: 0, knocks: 1, alone: false }));
    expect((await knock(env, doors)).read).toBe(2);
    fetchMock.intercept({ method: "POST", url: FETCH, reply });
    const pages = ["a", "b", "c"].map((s, n) => ({ n, kind: "hit" as const, url: `https://${s}.com/`, name: s, home: `https://${s}.com/`, tries: 0, alone: false }));
    expect((await readItems(env, pages)).read).toBe(2);
  });

  it("adds 6,000 paid pages in all once a cap is set, and counts the ones already used on other days", async () => {
    const paying = { ...env, SPEND_CAP_USD: "20" };
    await env.DB.prepare("INSERT INTO limits (day, name, count) VALUES ('2026-11-01', 'reads', 1100), (?, 'reads', 795)").bind(today()).run();
    expect(await readsLeft(paying, today())).toBe(5 + 6000 - 300);
    expect(await readsLeft(env, today())).toBe(5);
  });
});

describe("searching one site", () => {
  it("asks for the company's name on its own site between two dates", async () => {
    fetchMock.intercept({ method: "GET", url: SEARCH, reply: { json: { results: [{ url: "https://stripe.com/blog/a", title: "A", date: "Nov 5, 2026" }] } } });
    const got = await searchSite(env, "Stripe", "stripe.com", { after: "2023-11-12", before: "2025-11-12" });
    expect(got).toEqual({ ok: true, results: [{ url: "https://stripe.com/blog/a", title: "A", date: "Nov 5, 2026" }] });
    const asked = new URL(fetchMock.calls[0]!.url);
    expect(Object.fromEntries(asked.searchParams)).toEqual({ query: "Stripe", include_domains: "stripe.com", after_date: "2023-11-12", before_date: "2025-11-12" });
  });

  it("sends no dates when none are given", async () => {
    fetchMock.intercept({ method: "GET", url: SEARCH, reply: { json: { results: [] } } });
    await searchSite(env, "Stripe", "stripe.com", {});
    expect(Object.fromEntries(new URL(fetchMock.calls[0]!.url).searchParams)).toEqual({ query: "Stripe", include_domains: "stripe.com" });
  });

  it("says the search failed, never that it found nothing", async () => {
    fetchMock.intercept({ method: "GET", url: SEARCH, reply: { status: 429, body: "slow down" } });
    expect(await searchSite(env, "Stripe", "stripe.com", {})).toEqual({ ok: false, error: "http_429" });
    fetchMock.intercept({ method: "GET", url: SEARCH, reply: { json: { message: "no results field" } } });
    expect(await searchSite(env, "Stripe", "stripe.com", {})).toEqual({ ok: false, error: "bad_answer" });
  });
});

describe("the wallet", () => {
  it("reads the balance as a number of dollars", async () => {
    fetchMock.intercept({ method: "GET", url: "https://agent.tinyfish.ai/v1/wallet", reply: { json: { available_balance: "35.057", currency: "USD" } } });
    expect(await readBalance(env)).toBe(35.057);
  });

  it("refuses an answer that is not a dollar amount", async () => {
    fetchMock.intercept({ method: "GET", url: "https://agent.tinyfish.ai/v1/wallet", reply: { json: { available_balance: "a lot" } } });
    await expect(readBalance(env)).rejects.toThrow("bad_wallet");
  });
});
