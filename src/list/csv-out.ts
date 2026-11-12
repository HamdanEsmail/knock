// The sheet that goes back: the visitor's own cells, untouched and in their order, then
// Knock's thirteen columns. The same words serve the API's rows.
import { toCsv } from "../core/csv";
import { KNOCK_HEADER, doorWords, knockCells, linkWords, outsideWords, pagesWords } from "../core/sheet";
import type { Decision, Signs } from "../core/signs";
import type { FullRow, ListRecord } from "./store";

export function signsOf(r: FullRow): Signs {
  return { name: r.name, address: r.address, door: r.door, pages: r.pages, reads: r.reads ?? [], outside: r.outside };
}

/** The verdict as it was decided, or null for a row that has none yet. */
export function decisionOf(r: FullRow): Decision | null {
  if (r.verdict === null) return null;
  return { verdict: r.verdict, rule: r.rule ?? 0, lastSeen: r.lastSeen, lastSeenFrom: r.lastSeenFrom as Decision["lastSeenFrom"], why: r.why ?? "", evidence: r.evidence };
}

/** The whole sheet as CSV. A line shorter than the sheet is wide is filled out with empty cells. */
export function sheetOut(list: ListRecord, rows: FullRow[]): string {
  const width = list.header.length;
  const lines = [[...list.header, ...KNOCK_HEADER]];
  for (const r of rows) {
    const own = Array.from({ length: Math.max(width, r.cells.length) }, (_, i) => r.cells[i] ?? "").slice(0, width);
    lines.push([...own, ...knockCells(signsOf(r), decisionOf(r), r.checkedOn)]);
  }
  return toCsv(lines);
}

/** One row as the API gives it: the verdict, and each sign in words. */
export function rowOut(r: FullRow) {
  const reads = r.reads ?? [];
  const read = (kind: "jobs" | "signup") => reads.find((it) => it.kind === kind);
  return {
    n: r.n,
    name: r.name,
    address: r.address,
    verdict: r.verdict,
    rule: r.rule,
    last_seen: r.lastSeen,
    last_seen_from: r.lastSeenFrom,
    why: r.why,
    door: doorWords(r.door),
    new_pages: pagesWords(r.pages, reads, r.address !== null),
    jobs_page: linkWords(r.door?.jobsLink ?? null, read("jobs")),
    signup_page: linkWords(r.door?.signupLink ?? null, read("signup")),
    outside: outsideWords(r.outside, reads),
    evidence: r.evidence,
    checked_on: r.checkedOn,
  };
}

/** How many rows of a list have each verdict, read from its wall. */
export function countsOf(wall: string): { alive: number; slowing_down: number; zombie: number; could_not_tell: number; not_yet: number } {
  const counts = { alive: 0, slowing_down: 0, zombie: 0, could_not_tell: 0, not_yet: 0 };
  for (const c of wall) {
    if (c === "a") counts.alive++;
    else if (c === "s") counts.slowing_down++;
    else if (c === "z") counts.zombie++;
    else if (c === "u") counts.could_not_tell++;
    else counts.not_yet++;
  }
  return counts;
}
