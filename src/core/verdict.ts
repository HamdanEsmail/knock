// The verdict: nine rules, the first that matches wins (design, section 5). It is a pure
// function of the signs, so the same signs always give the same verdict, and every verdict
// can name the rule and the links it rests on.
import { hostOf, sameSite, siteOf } from "./address";
import { monthsAgo, showDay } from "./dates";
import { ALIVE_MONTHS, ZOMBIE_MONTHS } from "./limits";
import type { DateFrom, Decision, DoorKind, ReadItem, ReadKind, Signs, Verdict } from "./signs";

/**
 * Sites whose pages are shown and decide nothing. Y Combinator's own record is what Knock is
 * scored against on the demo list, so it must not be where a verdict comes from.
 */
const DECIDES_NOTHING = new Set(["ycombinator.com"]);

type Dated = { day: string; from: DateFrom; url: string };

const unique = (links: (string | null | undefined)[]): string[] => [...new Set(links.filter((l): l is string => typeof l === "string" && l !== ""))];

export function decide(s: Signs, today: string): Decision {
  const door = s.door;
  const kind: DoorKind = door?.kind ?? (s.address === null ? "no_address" : "not_asked");
  const readOk = (k: ReadKind): ReadItem | null => s.reads.find((r) => r.kind === k && r.done && r.ok) ?? null;
  const decides = (url: string | null): boolean => url !== null && !DECIDES_NOTHING.has(siteOf(hostOf(url)));

  // What TinySet said counts only through a link that was read today and names the company.
  const out = s.outside?.returned ? s.outside : null;
  const backing = (k: "source" | "activity", url: string | null): ReadItem | null => {
    const item = out !== null && decides(url) ? readOk(k) : null;
    return item !== null && item.namesIt !== false ? item : null;
  };
  const source = backing("source", out?.outcomeSource ?? null);
  const activity = backing("activity", out?.activityLink ?? null);
  const operates = out !== null && (source !== null || activity !== null) ? out.operates : null;
  const outcome = out?.outcome ?? null;

  // The dated signs that were read today, newest first.
  const dated: Dated[] = [];
  for (const [k, hit] of [["hit", s.pages?.newest], ["hit2", s.pages?.second]] as const) {
    const item = hit ? readOk(k) : null;
    if (!hit || item === null || !sameSite(item.finalUrl ?? item.url, hit.url)) continue;
    const own = item.pageDate !== null && item.pageDate <= today ? item.pageDate : null;
    dated.push({ day: own ?? hit.date, from: own !== null ? "the page's own date" : "date from search", url: item.finalUrl ?? item.url });
  }
  if (activity !== null && out?.activityDate && out.activityDate <= today) dated.push({ day: out.activityDate, from: "from TinySet's source", url: activity.finalUrl ?? activity.url });
  const open = kind === "answers" || (kind === "forwards" && door?.namesIt === true);
  if (door?.serverDate && door.finalUrl && open && monthsAgo(door.serverDate, today) >= ALIVE_MONTHS) dated.push({ day: door.serverDate, from: "the server's date for the home page", url: door.finalUrl });
  dated.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  const newest = dated[0] ?? null;
  /** A page the index lists but that could not be read today: good for "last seen", never for a verdict. */
  const listed = newest === null ? (s.pages?.newest ?? null) : null;

  const doorLink = door !== null && ["answers", "forwards", "for_sale", "nearly_empty"].includes(kind) ? door.finalUrl : null;
  const jobs = open ? readOk("jobs") : null;
  const signup = open ? readOk("signup") : null;
  const supporting = [doorLink, ...dated.map((d) => d.url), jobs?.finalUrl ?? jobs?.url, signup?.finalUrl ?? signup?.url, source?.finalUrl ?? source?.url, activity?.finalUrl ?? activity?.url];

  const answer = (verdict: Verdict, rule: number, why: string, first: string | null, seen: { day: string; from: DateFrom } | null = newest ?? (listed ? { day: listed.date, from: "date from search" } : null)): Decision => ({
    verdict,
    rule,
    lastSeen: seen?.day ?? null,
    lastSeenFrom: seen?.from ?? null,
    why,
    evidence: unique([first, ...supporting]),
  });

  const twice = (door?.knocks ?? 1) >= 2 ? " twice" : "";
  const months = newest === null ? null : monthsAgo(newest.day, today);
  const said = outcome !== null && outcome !== "" ? ` TinySet says: ${outcome}.` : "";

  // 1. TinySet says it no longer operates, and its source was read.
  if (operates === false && source !== null && out !== null) {
    const seen: { day: string; from: DateFrom } | null =
      activity !== null && out.activityDate ? { day: out.activityDate, from: "from TinySet's source" } : out.outcomeDate ? { day: out.outcomeDate, from: "from TinySet's source" } : null;
    const on = out.outcomeDate ? `, on ${showDay(out.outcomeDate)}` : "";
    return answer("zombie", 1, `TinySet found that it no longer operates: ${outcome ?? "no reason given"}${on}. The source was read today.`, source.finalUrl ?? source.url, seen ?? undefined);
  }
  // 2. The address is for sale.
  if (kind === "for_sale") return answer("zombie", 2, `The address is for sale.${door?.toHost ? ` It leads to ${door.toHost}.` : ""}`, doorLink);
  // 3. The address no longer exists, and nothing says the company operates under another.
  if (kind === "gone" && operates !== true) {
    const last = listed ? ` Search last lists a page there dated ${showDay(listed.date)}.` : "";
    return answer("zombie", 3, `The address no longer exists.${twice ? " It was asked twice." : ""}${last}`, door?.asked ?? s.address);
  }
  // 4. The address forwards to a site that does not name the company, and nothing says it still operates.
  if (kind === "forwards" && door?.namesIt === false && operates !== true) return answer("zombie", 4, `The address now leads to ${door.toHost}, which does not name ${s.name}.`, doorLink);

  // What the door adds to a verdict that a dated sign decides.
  const aside =
    kind === "forwards"
      ? door?.namesIt
        ? ` The address now leads to ${door.toHost}, which names it.`
        : ` The address on the sheet now leads to ${door?.toHost}.`
      : kind === "gone"
        ? " The address on the sheet no longer exists."
        : kind === "nearly_empty"
          ? " The home page itself is nearly empty."
          : ["error", "timed_out", "blocked", "not_asked"].includes(kind)
            ? " The home page could not be read today."
            : "";
  const what = (d: Dated): string =>
    d.from === "the page's own date"
      ? `a page of its site dated ${showDay(d.day)}`
      : d.from === "date from search"
        ? `a page of its site that Search dates ${showDay(d.day)}`
        : d.from === "from TinySet's source"
          ? `a source that shows activity on ${showDay(d.day)}`
          : `the home page, which the server says last changed on ${showDay(d.day)}`;

  if (newest !== null && months !== null) {
    // 5. A dated sign from the last twelve months.
    if (months < ALIVE_MONTHS) return answer("alive", 5, `Read today: ${what(newest)}.${aside}${operates === true ? said : ""}`, newest.url);
    // 6. The newest dated sign is 12 to 36 months old.
    if (months < ZOMBIE_MONTHS) return answer("slowing down", 6, `The newest dated sign read today is ${what(newest)}, ${months} months ago.${aside}`, newest.url);
    // 7. The newest dated sign is more than 36 months old.
    return answer("zombie", 7, `The newest dated sign read today is ${what(newest)}, more than three years ago.${aside}`, newest.url);
  }
  // 6, without a date: the door answers and a jobs or sign-up page is there; or TinySet says it operates.
  if (open && (jobs !== null || signup !== null)) {
    const there = jobs !== null && signup !== null ? "its jobs and sign-up pages are there" : jobs !== null ? "its jobs page is there" : "its sign-up page is there";
    return answer("slowing down", 6, `Nothing on the site carries a date, but the home page answers and ${there}.`, doorLink);
  }
  if (operates === true) return answer("slowing down", 6, `A source read today says it still operates${outcome ? ` (${outcome})` : ""}, but nothing dated was found.${aside}`, source?.finalUrl ?? source?.url ?? activity?.finalUrl ?? activity?.url ?? null);
  // 8. The page is nearly empty and nothing else was found.
  if (kind === "nearly_empty") return answer("zombie", 8, "The home page is nearly empty and nothing else was found.", doorLink ?? door?.asked ?? null);

  // 9. Everything else, with the reason.
  const reason =
    kind === "no_address"
      ? s.outside === null
        ? "No address was given, and TinySet was not asked about this row."
        : !s.outside.returned
          ? "No address was given, and TinySet returned nothing for this name."
          : "No address was given, and none of TinySet's sources could be read today."
      : kind === "error"
        ? `The home page answered with an error${twice}, and nothing dated on the site could be read.`
        : kind === "timed_out"
          ? `The home page did not answer in time${twice}, and nothing dated on the site could be read.`
          : kind === "blocked"
            ? "The site blocks readers, and nothing dated on it could be read."
            : kind === "not_asked"
              ? "The address could not be asked today."
              : kind === "answers"
                ? "The home page answers, but nothing on the site carries a date and no jobs or sign-up page could be read."
                : kind === "forwards" && door?.namesIt
                  ? `The address now leads to ${door.toHost}, which names it, but nothing dated was found there.`
                  : "Nothing Knock found decides it.";
  const search = s.pages?.failed ? " Search could not be asked." : "";
  const unread = listed ? ` Search lists a page dated ${showDay(listed.date)}, which could not be read today.` : "";
  return answer("could not tell", 9, `${reason}${search}${unread}`, doorLink);
}
