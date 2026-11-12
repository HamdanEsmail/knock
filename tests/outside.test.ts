import { describe, expect, it } from "vitest";
import { matchRows } from "../src/outside/match";
import { pickRows, type Candidate } from "../src/outside/pick";
import { specFor } from "../src/outside/spec";

const SENT = [
  { n: 3, name: "Rdio", address: "https://www.rdio.com/" },
  { n: 9, name: "Yik Yak", address: "http://yikyak.com/" },
  { n: 12, name: "Wesabe", address: null },
];

describe("what a set asks TinySet for", () => {
  it("writes the list into the description, each name with its site, and says when no site is known", () => {
    const spec = specFor(SENT);
    expect(spec.name).toBe("Signs of life for 3 listed companies");
    expect(spec.description).toContain("Rdio (rdio.com); Yik Yak (yikyak.com); Wesabe (no website known)");
    expect(spec.description).toContain("no other company");
    expect(spec.description).toContain("A company that is not on the list is never a row.");
  });

  it("has the company's name as its key, and the eight columns in the order they are read", () => {
    const spec = specFor(SENT);
    expect(spec.columns.map((c) => c.name)).toEqual(["company_name", "website", "still_operates", "outcome", "outcome_date", "outcome_source", "most_recent_activity_date", "most_recent_activity_link"]);
    expect(spec.columns.filter((c) => c.is_primary_key).map((c) => c.name)).toEqual(["company_name"]);
    expect(spec.columns[0]?.retrieval_hint).toContain("Rdio, Yik Yak, Wesabe");
    expect(spec.columns[1]?.examples).toEqual(["rdio.com", "yikyak.com"]);
  });

  it("asks for a source that is not a directory's page about the company", () => {
    const source = specFor(SENT).columns.find((c) => c.name === "outcome_source");
    expect(source?.retrieval_hint).toMatch(/not a directory/i);
    expect(source?.retrieval_hint).toContain("Y Combinator");
  });

  it("keeps the key's hint under TinySet's 2,000 characters however long the names are", () => {
    const long = Array.from({ length: 50 }, (_, n) => ({ n, name: `A company with a very long name indeed, number ${n} of fifty in this list`, address: null }));
    const spec = specFor(long);
    expect(spec.columns[0]?.retrieval_hint.length).toBeLessThanOrEqual(2000);
    expect(spec.description).toContain("number 49 of fifty");
  });
});

describe("matching what came back to what was sent", () => {
  const row = (data: Record<string, unknown>) => data;

  it("matches a row by its name and site, whatever the capitals, the spacing and the form of the address", () => {
    const got = matchRows(SENT, [
      row({ company_name: "rdio", website: "http://rdio.com/about", still_operates: false, outcome: "shut down (assets acquired by Pandora)", outcome_date: "2015-11-16", outcome_source: "https://variety.com/2015/rdio", most_recent_activity_date: "2015-12-22", most_recent_activity_link: "https://variety.com/2015/rdio" }),
      row({ company_name: "YikYak, Inc.", website: "yikyak.com", still_operates: true, outcome: "acquired by Sidechat", outcome_date: "", outcome_source: "", most_recent_activity_date: null, most_recent_activity_link: "https://apps.apple.com/app/yik-yak" }),
    ]);
    expect(got.matched.get(3)).toEqual({ returned: true, operates: false, outcome: "shut down (assets acquired by Pandora)", outcomeDate: "2015-11-16", outcomeSource: "https://variety.com/2015/rdio", activityDate: "2015-12-22", activityLink: "https://variety.com/2015/rdio" });
    expect(got.matched.get(9)).toEqual({ returned: true, operates: true, outcome: "acquired by Sidechat", outcomeDate: null, outcomeSource: null, activityDate: null, activityLink: "https://apps.apple.com/app/yik-yak" });
    expect(got.missing).toEqual([12]);
    expect(got.offList).toEqual([]);
    expect(got.wrongSite).toEqual([]);
  });

  it("throws away a company that is not on the list, and a listed name on another site", () => {
    const got = matchRows(SENT, [row({ company_name: "Spotify", website: "spotify.com", still_operates: true }), row({ company_name: "Rdio", website: "https://rdio.fm", still_operates: true })]);
    expect(got.matched.size).toBe(0);
    expect(got.offList).toEqual(["Spotify"]);
    expect(got.wrongSite).toEqual(["Rdio (rdio.fm, sent rdio.com)"]);
    expect(got.missing).toEqual([3, 9, 12]);
  });

  it("takes a row for a company sent without an address, whatever site comes back with it", () => {
    const got = matchRows(SENT, [row({ company_name: "Wesabe", website: "https://wesabe.com", still_operates: false, outcome: "shut down" })]);
    expect(got.matched.get(12)?.operates).toBe(false);
    expect(got.missing).toEqual([3, 9]);
  });

  it("keeps only what has the right shape: a true or false, a full date, a web link", () => {
    const got = matchRows(SENT, [row({ company_name: "Rdio", website: "rdio.com", still_operates: "false", outcome: "  ", outcome_date: "November 2015", outcome_source: "variety.com/rdio", most_recent_activity_date: "2015-12-22T10:00:00Z", most_recent_activity_link: "javascript:alert(1)" })]);
    expect(got.matched.get(3)).toEqual({ returned: true, operates: false, outcome: null, outcomeDate: null, outcomeSource: null, activityDate: "2015-12-22", activityLink: null });
    const unsure = matchRows(SENT, [row({ company_name: "Rdio", website: "rdio.com", still_operates: "unknown" })]);
    expect(unsure.matched.get(3)?.operates).toBeNull();
  });

  it("takes the first of two rows for the same company, and ignores a row without a name", () => {
    const got = matchRows(SENT, [row({ company_name: "Rdio", website: "rdio.com", still_operates: false }), row({ company_name: "Rdio", website: "rdio.com", still_operates: true }), row({ website: "rdio.com" }), row({ company_name: 7 })]);
    expect(got.matched.get(3)?.operates).toBe(false);
    expect(got.offList).toEqual([]);
  });
});

describe("which rows go to TinySet", () => {
  const c = (n: number, name: string, kind: string | null, extra: Partial<Candidate> = {}): Candidate => ({ n, name, door: kind, namesIt: null, verdict: "could not tell", rule: 9, setId: null, ...extra });

  it("takes them in the order of what an outside source can add, and in the sheet's order within each kind", () => {
    const rows = [
      c(0, "Loads And New", "answers", { verdict: "alive", rule: 5 }),
      c(1, "Loads Silent", "answers", { verdict: "slowing down", rule: 6 }),
      c(2, "Nearly Empty", "nearly_empty", { verdict: "zombie", rule: 8 }),
      c(3, "Errors", "error"),
      c(4, "Gone", "gone", { verdict: "zombie", rule: 3 }),
      c(5, "No Address", "no_address"),
      c(6, "Forwards", "forwards", { namesIt: false, verdict: "zombie", rule: 4 }),
      c(7, "Timed Out", "timed_out"),
      c(8, "For Sale", "for_sale", { verdict: "zombie", rule: 2 }),
      c(9, "Forwards Too", "forwards", { namesIt: true, verdict: "alive", rule: 5 }),
    ];
    expect(pickRows(rows, 50)).toEqual([6, 9, 5, 4, 3, 7, 2, 1]);
    expect(pickRows(rows, 3)).toEqual([6, 9, 5]);
  });

  it("never takes a row that is in a set already, and never two rows with the same name in one set", () => {
    const rows = [c(0, "Weave", "gone"), c(1, "Castle", "gone", { setId: "4" }), c(2, "weave", "gone"), c(3, "Weave, Inc.", "error")];
    expect(pickRows(rows, 50)).toEqual([0]);
  });

  it("takes exactly the rows I name, in my order, when they may be taken", () => {
    const rows = [c(0, "Weave", "gone"), c(1, "Castle", "gone", { setId: "4" }), c(2, "weave", "gone"), c(3, "Other", "answers", { verdict: "alive", rule: 5 })];
    expect(pickRows(rows, 50, [3, 2, 1, 0, 99])).toEqual([3, 2]);
  });
});
