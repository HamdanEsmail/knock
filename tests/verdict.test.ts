import { describe, expect, it } from "vitest";
import { decide } from "../src/core/verdict";
import type { DoorKind, DoorSign, Hit, OutsideSign, PagesSign, ReadItem, ReadKind, Signs, Window } from "../src/core/signs";

const TODAY = "2026-11-12";

const door = (kind: DoorKind, over: Partial<DoorSign> = {}): DoorSign => ({
  kind,
  asked: "https://acme.com/",
  finalUrl: ["answers", "forwards", "for_sale", "nearly_empty"].includes(kind) ? "https://acme.com/" : null,
  toHost: null,
  namesIt: null,
  title: null,
  chars: kind === "nearly_empty" ? 40 : 3000,
  serverDate: null,
  jobsLink: null,
  signupLink: null,
  error: null,
  knocks: 1,
  ...over,
});
const hit = (date: string, url = "https://acme.com/blog/post"): Hit => ({ url, title: "A post", date });
const pages = (newest: Hit | null, found: Window | null = newest ? "12" : null, over: Partial<PagesSign> = {}): PagesSign => ({
  host: "acme.com",
  done: true,
  asked: ["12", "36", "any"],
  found,
  newest,
  second: null,
  count: newest ? 1 : 0,
  undated: 0,
  failed: null,
  ...over,
});
const read = (kind: ReadKind, url: string, over: Partial<ReadItem> = {}): ReadItem => ({ kind, url, done: true, ok: true, finalUrl: url, title: null, pageDate: null, namesIt: null, error: null, tries: 1, ...over });
const outside = (over: Partial<OutsideSign> = {}): OutsideSign => ({ returned: true, operates: null, outcome: null, outcomeDate: null, outcomeSource: null, activityDate: null, activityLink: null, ...over });
const signs = (over: Partial<Signs>): Signs => ({ name: "Acme", address: "https://acme.com/", door: door("answers"), pages: pages(null), reads: [], outside: null, ...over });

describe("the table in the design", () => {
  it("Stripe: the door answers and a post of 5 Nov 2026 was read: alive", () => {
    const d = decide(signs({ name: "Stripe", pages: pages(hit("2026-11-05", "https://stripe.com/blog/a")), reads: [read("hit", "https://stripe.com/blog/a", { pageDate: "2026-11-05" })] }), TODAY);
    expect(d).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-11-05", lastSeenFrom: "the page's own date" });
    expect(d.evidence[0]).toBe("https://stripe.com/blog/a");
  });

  it("Parse: TinySet's source, read today, says it no longer operates: zombie, whatever carries the name now", () => {
    const d = decide(
      signs({
        name: "Parse",
        door: door("forwards", { toHost: "parseplatform.org", namesIt: true, finalUrl: "https://parseplatform.org/" }),
        pages: pages(hit("2026-11-10", "https://parseplatform.org/blog/x"), "12", { host: "parseplatform.org" }),
        reads: [read("hit", "https://parseplatform.org/blog/x"), read("source", "https://techcrunch.com/parse-shut-down", { namesIt: true })],
        outside: outside({ operates: false, outcome: "acquired by Facebook; shut down", outcomeDate: "2017-01-28", outcomeSource: "https://techcrunch.com/parse-shut-down" }),
      }),
      TODAY,
    );
    expect(d).toMatchObject({ verdict: "zombie", rule: 1, lastSeen: "2017-01-28", lastSeenFrom: "from TinySet's source" });
    expect(d.evidence[0]).toBe("https://techcrunch.com/parse-shut-down");
  });

  it("Rdio: shut down, source read: zombie", () => {
    const d = decide(
      signs({
        name: "Rdio",
        door: door("error", { error: "target_http_error", knocks: 2 }),
        reads: [read("source", "https://variety.com/rdio", { namesIt: true }), read("activity", "https://variety.com/rdio", { namesIt: true })],
        outside: outside({ operates: false, outcome: "shut down (assets acquired by Pandora)", outcomeDate: "2015-11-16", outcomeSource: "https://variety.com/rdio", activityDate: "2015-12-22", activityLink: "https://variety.com/rdio" }),
      }),
      TODAY,
    );
    expect(d).toMatchObject({ verdict: "zombie", rule: 1, lastSeen: "2015-12-22", lastSeenFrom: "from TinySet's source" });
    expect(d.why).toContain("shut down");
  });

  it("Airmada: the address is for sale: zombie", () => {
    const d = decide(signs({ door: door("for_sale", { finalUrl: "https://www.atom.com/name/Airmada", toHost: "atom.com" }) }), TODAY);
    expect(d).toMatchObject({ verdict: "zombie", rule: 2 });
    expect(d.evidence[0]).toBe("https://www.atom.com/name/Airmada");
  });

  it("GovPredict: forwards to a site that does not name it: zombie", () => {
    const d = decide(signs({ name: "GovPredict", door: door("forwards", { toHost: "quorum.us", namesIt: false, finalUrl: "https://www.quorum.us/" }) }), TODAY);
    expect(d).toMatchObject({ verdict: "zombie", rule: 4 });
    expect(d.why).toContain("quorum.us");
  });

  it("The Athletic: forwards to a site that names it, with new pages there: alive, now at the new address", () => {
    const d = decide(
      signs({
        name: "The Athletic",
        door: door("forwards", { toHost: "nytimes.com", namesIt: true, finalUrl: "https://www.nytimes.com/athletic/" }),
        pages: pages(hit("2026-11-02", "https://www.nytimes.com/athletic/1"), "12", { host: "nytimes.com" }),
        reads: [read("hit", "https://www.nytimes.com/athletic/1")],
      }),
      TODAY,
    );
    expect(d).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-11-02", lastSeenFrom: "date from search" });
    expect(d.why).toContain("nytimes.com");
  });

  it("Tarsnap: the door answers, the newest page is from 21 Mar 2025: slowing down", () => {
    const d = decide(signs({ pages: pages(hit("2025-03-21"), "36"), reads: [read("hit", "https://acme.com/blog/post")] }), TODAY);
    expect(d).toMatchObject({ verdict: "slowing down", rule: 6, lastSeen: "2025-03-21" });
  });

  it("Hickory: the door answers, a sign-up page is there, nothing dated: slowing down", () => {
    const d = decide(signs({ door: door("answers", { signupLink: "https://acme.com/signup" }), reads: [read("signup", "https://acme.com/signup")] }), TODAY);
    expect(d).toMatchObject({ verdict: "slowing down", rule: 6, lastSeen: null, lastSeenFrom: null });
    expect(d.evidence).toContain("https://acme.com/signup");
  });

  it("Hickory, when its newest page is older than 36 months: zombie", () => {
    const d = decide(signs({ door: door("answers", { signupLink: "https://acme.com/signup" }), pages: pages(hit("2021-06-01"), "any"), reads: [read("hit", "https://acme.com/blog/post"), read("signup", "https://acme.com/signup")] }), TODAY);
    expect(d).toMatchObject({ verdict: "zombie", rule: 7, lastSeen: "2021-06-01" });
  });

  it("a site that answers with an error twice, with pages from this year that were read: alive", () => {
    const d = decide(signs({ door: door("error", { error: "target_http_error", knocks: 2 }), pages: pages(hit("2026-09-01")), reads: [read("hit", "https://acme.com/blog/post")] }), TODAY);
    expect(d).toMatchObject({ verdict: "alive", rule: 5 });
    expect(d.why).toContain("home page could not be read");
  });

  it("the same, and the index knows nothing: could not tell", () => {
    const d = decide(signs({ door: door("error", { error: "target_http_error", knocks: 2 }) }), TODAY);
    expect(d).toMatchObject({ verdict: "could not tell", rule: 9, lastSeen: null });
    expect(d.why).toContain("error");
  });
});

describe("each rule at its edges", () => {
  it("rule 1 needs TinySet's source to have been read today", () => {
    const base = { door: door("answers"), outside: outside({ operates: false, outcome: "shut down", outcomeSource: "https://news.example/a" }) };
    expect(decide(signs({ ...base, reads: [read("source", "https://news.example/a", { ok: false, error: "timeout" })] }), TODAY).rule).not.toBe(1);
    expect(decide(signs({ ...base, reads: [] }), TODAY).rule).not.toBe(1);
    expect(decide(signs({ ...base, reads: [read("source", "https://news.example/a", { namesIt: true })] }), TODAY).rule).toBe(1);
  });

  it("a source on Y Combinator's own site is shown and decides nothing", () => {
    const d = decide(signs({ reads: [read("source", "https://www.ycombinator.com/companies/acme", { namesIt: true })], outside: outside({ operates: false, outcome: "shut down", outcomeSource: "https://www.ycombinator.com/companies/acme" }) }), TODAY);
    expect(d.rule).not.toBe(1);
  });

  it("rule 3: an address that no longer exists is a zombie, with the index's last date as last seen", () => {
    const d = decide(signs({ door: door("gone", { error: "invalid_url", knocks: 2 }), pages: pages(hit("2019-04-02"), "any") }), TODAY);
    expect(d).toMatchObject({ verdict: "zombie", rule: 3, lastSeen: "2019-04-02", lastSeenFrom: "date from search" });
    expect(d.evidence).toEqual(["https://acme.com/"]);
  });

  it("rules 3 and 4 give way when a source read today says the company operates", () => {
    const says = { reads: [read("activity", "https://news.example/now", { namesIt: true })], outside: outside({ operates: true, outcome: "renamed to Bolt", activityDate: "2026-10-01", activityLink: "https://news.example/now" }) };
    expect(decide(signs({ door: door("gone"), ...says }), TODAY)).toMatchObject({ verdict: "alive", rule: 5, lastSeenFrom: "from TinySet's source" });
    expect(decide(signs({ door: door("forwards", { toHost: "bolt.com", namesIt: false }), ...says }), TODAY)).toMatchObject({ verdict: "alive", rule: 5 });
    // The same claim without a link that could be read decides nothing.
    expect(decide(signs({ door: door("gone"), outside: says.outside, reads: [read("activity", "https://news.example/now", { ok: false, error: "timeout" })] }), TODAY).rule).toBe(3);
  });

  it("rule 5 turns on twelve months to the day", () => {
    const at = (date: string) => decide(signs({ pages: pages(hit(date)), reads: [read("hit", "https://acme.com/blog/post")] }), TODAY);
    expect(at("2025-11-13")).toMatchObject({ verdict: "alive", rule: 5 });
    expect(at("2025-11-12")).toMatchObject({ verdict: "slowing down", rule: 6 });
    expect(at("2023-11-13")).toMatchObject({ verdict: "slowing down", rule: 6 });
    expect(at("2023-11-12")).toMatchObject({ verdict: "zombie", rule: 7 });
  });

  it("a page listed by the index that could not be read today never makes a company alive", () => {
    const d = decide(signs({ door: door("timed_out", { knocks: 2 }), pages: pages(hit("2026-10-01")), reads: [read("hit", "https://acme.com/blog/post", { ok: false, error: "timeout" })] }), TODAY);
    expect(d).toMatchObject({ verdict: "could not tell", rule: 9, lastSeen: "2026-10-01", lastSeenFrom: "date from search" });
    expect(d.why).toContain("could not be read today");
    expect(d.evidence).not.toContain("https://acme.com/blog/post");
  });

  it("uses the page's own date when the page states one, and the next page when that date is old", () => {
    const d = decide(
      signs({
        pages: pages(hit("2026-05-07", "https://acme.com/terms"), "12", { second: hit("2026-03-01", "https://acme.com/blog/new"), count: 2 }),
        reads: [read("hit", "https://acme.com/terms", { pageDate: "2019-01-03" }), read("hit2", "https://acme.com/blog/new", { pageDate: "2026-03-01" })],
      }),
      TODAY,
    );
    expect(d).toMatchObject({ verdict: "alive", rule: 5, lastSeen: "2026-03-01", lastSeenFrom: "the page's own date" });
    expect(d.evidence[0]).toBe("https://acme.com/blog/new");
  });

  it("rule 6: TinySet says it operates, a link was read, nothing is dated: slowing down", () => {
    const d = decide(signs({ door: door("blocked", { error: "bot_blocked" }), reads: [read("source", "https://news.example/a", { namesIt: true })], outside: outside({ operates: true, outcome: "acquired by Big Co", outcomeSource: "https://news.example/a" }) }), TODAY);
    expect(d).toMatchObject({ verdict: "slowing down", rule: 6 });
    expect(d.why).toContain("acquired by Big Co");
  });

  it("the server's date counts only when it says nobody has touched the site for a year", () => {
    expect(decide(signs({ door: door("answers", { serverDate: "2026-11-11" }) }), TODAY)).toMatchObject({ verdict: "could not tell", rule: 9 });
    expect(decide(signs({ door: door("answers", { serverDate: "2024-06-01" }) }), TODAY)).toMatchObject({ verdict: "slowing down", rule: 6, lastSeen: "2024-06-01", lastSeenFrom: "the server's date for the home page" });
    expect(decide(signs({ door: door("answers", { serverDate: "2019-06-01" }) }), TODAY)).toMatchObject({ verdict: "zombie", rule: 7 });
  });

  it("rule 8: a nearly empty page with nothing else is a zombie, but not when a new page of the site was read", () => {
    expect(decide(signs({ door: door("nearly_empty") }), TODAY)).toMatchObject({ verdict: "zombie", rule: 8 });
    expect(decide(signs({ door: door("nearly_empty"), pages: pages(hit("2026-08-01")), reads: [read("hit", "https://acme.com/blog/post")] }), TODAY)).toMatchObject({ verdict: "alive", rule: 5 });
  });

  it("rule 8 does not say nothing else was found when Search lists a page that could not be read", () => {
    const d = decide(signs({ door: door("nearly_empty"), pages: pages(hit("2026-10-31")), reads: [read("hit", "https://acme.com/blog/post", { ok: false, error: "empty_content", finalUrl: null })] }), TODAY);
    expect(d).toMatchObject({ verdict: "zombie", rule: 8, lastSeen: "2026-10-31", lastSeenFrom: "date from search" });
    expect(d.why).toBe("The home page is nearly empty, and nothing else on the site could be read. Search lists a page dated 31 Oct 2026, which could not be read today.");
    expect(decide(signs({ door: door("nearly_empty") }), TODAY).why).toBe("The home page is nearly empty and nothing else was found.");
  });

  it("rule 9 says why: no address, blocked, could not be asked, nothing to go on", () => {
    expect(decide(signs({ address: null, door: door("no_address", { asked: null }), pages: null }), TODAY)).toMatchObject({ verdict: "could not tell", rule: 9, why: "No address was given, and TinySet was not asked about this row." });
    expect(decide(signs({ address: null, door: door("no_address", { asked: null }), pages: null, outside: outside({ returned: false }) }), TODAY).why).toBe("No address was given, and TinySet returned nothing for this name.");
    expect(decide(signs({ door: door("blocked", { error: "bot_blocked" }) }), TODAY).why).toContain("blocks readers");
    expect(decide(signs({ door: door("not_asked", { asked: "https://acme.com/" }), pages: pages(null, null, { failed: "http_429" }) }), TODAY).why).toContain("could not be asked");
    expect(decide(signs({}), TODAY)).toMatchObject({ verdict: "could not tell", rule: 9 });
  });

  it("a jobs or sign-up page counts only when it was read today", () => {
    const d = decide(signs({ door: door("answers", { jobsLink: "https://acme.com/careers" }), reads: [read("jobs", "https://acme.com/careers", { ok: false, error: "page_not_found" })] }), TODAY);
    expect(d).toMatchObject({ verdict: "could not tell", rule: 9 });
  });

  it("never gives a sentence or a link that a spreadsheet would run as a formula", () => {
    for (const s of [signs({}), signs({ door: door("gone") }), signs({ door: door("for_sale") }), signs({ address: null, door: door("no_address"), pages: null })]) {
      const d = decide(s, TODAY);
      expect(d.why).not.toMatch(/^[=+\-@]/);
      expect(d.why.endsWith(".")).toBe(true);
    }
  });
});
