import { describe, expect, it } from "vitest";
import { doorSentence, KNOCK_HEADER, knockCells } from "../src/core/sheet";
import type { Decision, DoorSign, Signs } from "../src/core/signs";

const signs: Signs = {
  name: "Acme",
  address: "https://acme.com/",
  door: { kind: "answers", asked: "https://acme.com/", finalUrl: "https://acme.com/", toHost: null, namesIt: null, title: "Acme", chars: 3000, serverDate: null, jobsLink: "https://acme.com/careers", signupLink: "https://acme.com/signup", error: null, knocks: 1 },
  pages: { host: "acme.com", done: true, asked: ["12"], found: "12", newest: { url: "https://acme.com/blog/a", title: "A", date: "2026-11-05" }, second: null, count: 3, undated: 0, failed: null },
  reads: [
    { kind: "hit", url: "https://acme.com/blog/a", done: true, ok: true, finalUrl: "https://acme.com/blog/a", title: "A", pageDate: "2026-11-05", namesIt: null, error: null, tries: 1 },
    { kind: "jobs", url: "https://acme.com/careers", done: true, ok: true, finalUrl: "https://acme.com/careers", title: null, pageDate: null, namesIt: null, error: null, tries: 1 },
    { kind: "signup", url: "https://acme.com/signup", done: true, ok: false, finalUrl: null, title: null, pageDate: null, namesIt: null, error: "timeout", tries: 1 },
  ],
  outside: null,
};
const decision: Decision = { verdict: "alive", rule: 5, lastSeen: "2026-11-05", lastSeenFrom: "the page's own date", why: "Read today: a page of its site dated 5 Nov 2026.", evidence: ["https://acme.com/blog/a", "https://acme.com/", "https://acme.com/careers", "https://acme.com/x"] };

describe("the columns Knock adds to a sheet", () => {
  it("are thirteen, named as the design names them", () => {
    expect(KNOCK_HEADER).toEqual([
      "knock_verdict",
      "knock_last_seen",
      "knock_last_seen_from",
      "knock_why",
      "knock_door",
      "knock_new_pages",
      "knock_jobs_page",
      "knock_signup_page",
      "knock_outside",
      "knock_evidence_1",
      "knock_evidence_2",
      "knock_evidence_3",
      "knock_checked_on",
    ]);
  });

  it("carry the verdict, the date and where it comes from, every sign and three links", () => {
    expect(knockCells(signs, decision, "2026-11-12")).toEqual([
      "alive",
      "2026-11-05",
      "the page's own date",
      "Read today: a page of its site dated 5 Nov 2026.",
      "answers",
      "3 dated pages in the last 12 months; the newest, 5 Nov 2026, was read today: https://acme.com/blog/a",
      "there: https://acme.com/careers",
      "linked, could not be read today: https://acme.com/signup",
      "not asked",
      "https://acme.com/blog/a",
      "https://acme.com/",
      "https://acme.com/careers",
      "2026-11-12",
    ]);
  });

  it("say what each sign found when it found nothing", () => {
    const cells = knockCells(
      { ...signs, door: { ...signs.door!, kind: "gone", finalUrl: null, jobsLink: null, signupLink: null, error: "invalid_url", knocks: 2 }, pages: { ...signs.pages!, found: null, newest: null, count: 0, asked: ["12", "36", "any"] }, reads: [], outside: { returned: false, operates: null, outcome: null, outcomeDate: null, outcomeSource: null, activityDate: null, activityLink: null } },
      { verdict: "zombie", rule: 3, lastSeen: null, lastSeenFrom: null, why: "The address no longer exists. It was asked twice.", evidence: ["https://acme.com/"] },
      "2026-11-12",
    );
    expect(cells.slice(4, 9)).toEqual(["the address no longer exists (asked twice)", "Search knows no dated page of this site", "none found", "none found", "TinySet returned nothing"]);
    expect(cells.slice(9, 12)).toEqual(["https://acme.com/", "", ""]);
  });

  it("are empty, but for the door, on a row that has no verdict yet", () => {
    const cells = knockCells({ ...signs, pages: null, reads: [] }, null, null);
    expect(cells).toHaveLength(13);
    expect(cells[0]).toBe("");
    expect(cells[12]).toBe("");
  });

  it("never begin with a character a spreadsheet would run as a formula", () => {
    const cells = knockCells(
      { ...signs, outside: { returned: true, operates: true, outcome: "=HYPERLINK(1)", outcomeDate: null, outcomeSource: null, activityDate: null, activityLink: null } },
      { ...decision, why: "=SUM(A1)", evidence: ["@x", "+1", "-1"] },
      "2026-11-12",
    );
    for (const cell of cells) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });
});

describe("what a row's page says about its door", () => {
  const door = (over: Partial<DoorSign>): DoorSign => ({ kind: "answers", asked: "https://acme.com/", finalUrl: "https://acme.com/", toHost: null, namesIt: null, title: null, chars: 3000, serverDate: null, jobsLink: null, signupLink: null, error: null, knocks: 1, ...over });

  it("is a whole sentence for every kind of answer", () => {
    expect(doorSentence(door({}))).toBe("Its address answers.");
    expect(doorSentence(door({ kind: "forwards", toHost: "other.com", namesIt: true }))).toBe("Its address forwards to other.com, which names it.");
    expect(doorSentence(door({ kind: "forwards", toHost: "other.com", namesIt: false }))).toBe("Its address forwards to other.com, which does not name it.");
    expect(doorSentence(door({ kind: "for_sale" }))).toBe("Its address is for sale.");
    expect(doorSentence(door({ kind: "nearly_empty" }))).toBe("Its address answers, and the home page is nearly empty.");
    expect(doorSentence(door({ kind: "gone", knocks: 2 }))).toBe("Its address no longer exists (asked twice).");
    expect(doorSentence(door({ kind: "gone" }))).toBe("Its address no longer exists.");
    expect(doorSentence(door({ kind: "error", knocks: 2 }))).toBe("Its address answered with an error (asked twice).");
    expect(doorSentence(door({ kind: "timed_out", knocks: 2 }))).toBe("Its address did not answer in time (asked twice).");
    expect(doorSentence(door({ kind: "blocked" }))).toBe("Its address blocks readers.");
    expect(doorSentence(door({ kind: "not_asked" }))).toBe("Its address could not be asked today.");
  });

  it("says so when there is no address, or when the door has not been knocked on yet", () => {
    expect(doorSentence(door({ kind: "no_address" }))).toBe("No address was given for this row.");
    expect(doorSentence(null)).toBe("Its address has not been asked yet.");
  });
});
