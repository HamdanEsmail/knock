// New pages: what TinyFish Search lists on a company's own site, asked window by window,
// the last twelve months first. A page's date here is the index's; the reading stage reads
// the page itself and uses its own date where it states one.
import { sameSite } from "./address";
import { monthsAgo, monthsBefore, searchDay } from "./dates";
import { ALIVE_MONTHS, ZOMBIE_MONTHS } from "./limits";
import { namesCompany } from "./names";
import type { Hit, PagesSign, Window } from "./signs";

const WINDOWS: Window[] = ["12", "36", "any"];

/** The dates a window is asked with. */
export function windowDates(w: Window, today: string): { after?: string; before?: string } {
  if (w === "12") return { after: monthsBefore(today, ALIVE_MONTHS) };
  if (w === "36") return { after: monthsBefore(today, ZOMBIE_MONTHS), before: monthsBefore(today, ALIVE_MONTHS) };
  return {};
}

type Listed = { url: string; title: string; snippet: string; date: unknown };

/** The results that are pages on the site at `host`. With `name`, only those whose title or summary names the company. */
function listedOn(results: unknown[], host: string, name?: string): Listed[] {
  const out: Listed[] = [];
  for (const r of results) {
    if (typeof r !== "object" || r === null) continue;
    const { url, title, snippet, date } = r as Record<string, unknown>;
    if (typeof url !== "string" || !sameSite(url, `https://${host}/`)) continue;
    const listed = { url, title: typeof title === "string" ? title : "", snippet: typeof snippet === "string" ? snippet : "", date };
    if (name !== undefined && !namesCompany(`${listed.title}\n${listed.snippet}`, name)) continue;
    out.push(listed);
  }
  return out;
}

/**
 * The dated pages on the site, newest first. A result on another site is dropped, and so is
 * one whose date is in no known shape or has not come yet.
 */
export function hitsOn(results: unknown[], host: string, today: string, name?: string): Hit[] {
  const hits: Hit[] = [];
  for (const r of listedOn(results, host, name)) {
    const date = searchDay(r.date, today);
    if (date !== null) hits.push({ url: r.url, title: r.title, date });
  }
  return hits.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The sign before anything has been asked. */
export function newAsk(host: string): PagesSign {
  return { host, done: false, asked: [], found: null, newest: null, second: null, count: 0, undated: 0, failed: null };
}

/** The window to ask next, or null when the sign is complete. */
export function nextWindow(sign: PagesSign): Window | null {
  return sign.done ? null : (WINDOWS.find((w) => !sign.asked.includes(w)) ?? null);
}

/** The window a day falls in. */
export function windowOf(day: string, today: string): Window {
  const months = monthsAgo(day, today);
  return months < ALIVE_MONTHS ? "12" : months < ZOMBIE_MONTHS ? "36" : "any";
}

/**
 * The sign after one window has been asked. It is complete as soon as a window has a dated
 * page, or when the last window has none. `name` is given when the host is not the company's
 * own but the one its address now leads to.
 */
export function afterAsk(sign: PagesSign, window: Window, results: unknown[], today: string, name?: string): PagesSign {
  const asked = sign.asked.includes(window) ? sign.asked : [...sign.asked, window];
  const hits = hitsOn(results, sign.host, today, name);
  const undated = listedOn(results, sign.host, name).length - hits.length;
  const newest = hits[0];
  if (newest === undefined) return { ...sign, asked, undated, done: asked.length === WINDOWS.length };
  return { ...sign, asked, undated, done: true, found: windowOf(newest.date, today), newest, second: hits[1] ?? null, count: hits.length };
}
