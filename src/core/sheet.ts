// The columns Knock adds to a sheet, after the visitor's own. One column for each sign, so
// the signs behind a verdict can be seen in the sheet itself.
import { showDay } from "./dates";
import type { Decision, DoorSign, OutsideSign, PagesSign, ReadItem, Signs } from "./signs";

export const KNOCK_HEADER = [
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
];

/** A spreadsheet runs a cell that begins with one of these as a formula. Knock's own cells never do. */
const safe = (cell: string): string => (/^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell);

export function doorWords(door: DoorSign | null): string {
  if (door === null) return "not asked yet";
  const twice = door.knocks >= 2 ? " (asked twice)" : "";
  switch (door.kind) {
    case "answers":
      return "answers";
    case "forwards":
      return `forwards to ${door.toHost}, which ${door.namesIt ? "names it" : "does not name it"}`;
    case "for_sale":
      return "for sale";
    case "nearly_empty":
      return "nearly empty";
    case "gone":
      return `the address no longer exists${twice}`;
    case "error":
      return `answered with an error${twice}`;
    case "timed_out":
      return `did not answer in time${twice}`;
    case "blocked":
      return "blocks readers";
    case "no_address":
      return "no address given";
    case "not_asked":
      return "could not be asked today";
  }
}

const WINDOW_WORDS = { "12": "in the last 12 months", "36": "12 to 36 months ago", any: "more than 36 months ago" } as const;

export function pagesWords(pages: PagesSign | null, reads: ReadItem[], hasAddress: boolean): string {
  if (pages === null) return hasAddress ? "not asked yet" : "no address given";
  if (pages.failed !== null) return "Search could not be asked today";
  if (!pages.done) return "being asked";
  if (pages.newest === null || pages.found === null) return pages.undated > 0 ? "Search lists pages of this site, but none with a date" : "Search knows no dated page of this site";
  const item = reads.find((r) => r.kind === "hit" && r.done);
  const read = item === undefined ? "is listed" : item.ok ? "was read today" : "could not be read today";
  return `${pages.count} dated ${pages.count === 1 ? "page" : "pages"} ${WINDOW_WORDS[pages.found]}; the newest, ${showDay(pages.newest.date)}, ${read}: ${pages.newest.url}`;
}

export function linkWords(link: string | null, item: ReadItem | undefined): string {
  if (link === null) return "none found";
  if (item === undefined || !item.done) return `linked: ${link}`;
  return item.ok ? `there: ${item.finalUrl ?? link}` : `linked, could not be read today: ${link}`;
}

export function outsideWords(outside: OutsideSign | null, reads: ReadItem[]): string {
  if (outside === null) return "not asked";
  if (!outside.returned) return "TinySet returned nothing";
  const note = (kind: "source" | "activity"): string => {
    const item = reads.find((r) => r.kind === kind && r.done);
    return item === undefined ? "" : item.ok ? ", read today" : ", could not be read today";
  };
  const parts = [outside.operates === true ? "operates" : outside.operates === false ? "no longer operates" : "does not say whether it operates"];
  if (outside.outcome) parts.push(`${outside.outcome}${outside.outcomeDate ? ` (${showDay(outside.outcomeDate)})` : ""}`);
  if (outside.outcomeSource) parts.push(`source${note("source")}: ${outside.outcomeSource}`);
  if (outside.activityDate) parts.push(`latest activity ${showDay(outside.activityDate)}${outside.activityLink ? `${note("activity")}: ${outside.activityLink}` : ""}`);
  return parts.join("; ");
}

/** Knock's thirteen cells for one row. A row without a verdict yet has its verdict cells empty. */
export function knockCells(signs: Signs, decision: Decision | null, checkedOn: string | null): string[] {
  const read = (kind: "jobs" | "signup") => signs.reads.find((r) => r.kind === kind);
  return [
    decision?.verdict ?? "",
    decision?.lastSeen ?? "",
    decision?.lastSeenFrom ?? "",
    decision?.why ?? "",
    doorWords(signs.door),
    pagesWords(signs.pages, signs.reads, signs.address !== null),
    linkWords(signs.door?.jobsLink ?? null, read("jobs")),
    linkWords(signs.door?.signupLink ?? null, read("signup")),
    outsideWords(signs.outside, signs.reads),
    decision?.evidence[0] ?? "",
    decision?.evidence[1] ?? "",
    decision?.evidence[2] ?? "",
    checkedOn ?? "",
  ].map(safe);
}
