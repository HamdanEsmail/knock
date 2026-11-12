// What each stage of a group owes, and the small pieces of work that pay it: one Fetch call,
// one search, one save. Every piece is small enough for one step of a Workflow run.
//
// A failed call is not a sign. A call that failed as a whole, an address that came back
// neither read nor refused, a search that was refused: each leaves its row owed and counts a
// try. Only after the last try does the row say that it could not be asked.
import { hostOf, otherScheme, sameSite } from "../core/address";
import { dayNow } from "../core/dates";
import { readDoor } from "../core/door";
import { DOOR_KNOCKS, READS_PER_CALL, SEARCHES_PER_DAY, SEARCHES_PER_MINUTE, TRIES } from "../core/limits";
import { namesCompany } from "../core/names";
import { afterAsk, newAsk, nextWindow, windowDates, windowOf } from "../core/pages";
import type { DoorKind, DoorSign, PageRead, PagesSign, ReadItem, ReadKind } from "../core/signs";
import { decide } from "../core/verdict";
import type { Env } from "../env";
import { NOT_ANSWERED, readPages } from "../tinyfish/fetch";
import { searchSite } from "../tinyfish/search";
import { bookReads, countReads, countSearches, getList, giveBack, loadGroup, patchList, refreshWall, rowsLeft, saveRows, spendCap, standing, takeSearches, type RowPatch, type RowState } from "./store";

export type Stage = "doors" | "search" | "doors2" | "search2" | "read" | "verdict";
export const STAGES: readonly Stage[] = ["doors", "search", "doors2", "search2", "read", "verdict"];

// ---- Beginning a leg ----

export type Begun = { rowCount: number; today: string; rows: RowState[] };

/** The group's rows, if this run still belongs to the list: a run of an older attempt gets null and stops. */
export async function begin(env: Env, listId: string, attempt: number, group: number, now: Date): Promise<Begun | null> {
  const list = await getList(env.DB, listId);
  if (list === null || list.attempt !== attempt || list.status === "done") return null;
  return { rowCount: list.rowCount, today: dayNow(now), rows: await loadGroup(env.DB, listId, group) };
}

/** The rows after what a step learned has been laid over them. */
export function apply(rows: RowState[], patches: RowPatch[]): RowState[] {
  const byRow = new Map<number, RowPatch[]>();
  for (const p of patches) byRow.set(p.n, [...(byRow.get(p.n) ?? []), p]);
  return rows.map((row) => {
    let next = row;
    for (const p of byRow.get(row.n) ?? []) {
      next = {
        ...next,
        ...(p.door !== undefined ? { door: p.door } : {}),
        ...(p.doorTries !== undefined ? { doorTries: p.doorTries } : {}),
        ...(p.pages !== undefined ? { pages: p.pages } : {}),
        ...(p.pagesTries !== undefined ? { pagesTries: p.pagesTries } : {}),
        ...(p.reads !== undefined ? { reads: p.reads } : {}),
        ...(p.outside !== undefined ? { outside: p.outside } : {}),
        ...(p.verdict !== undefined ? { verdict: p.verdict } : {}),
      };
    }
    return next;
  });
}

/** Several patches for the same row as one, the later over the earlier. */
export function merged(patches: RowPatch[]): RowPatch[] {
  const byRow = new Map<number, RowPatch>();
  for (const p of patches) byRow.set(p.n, { ...byRow.get(p.n), ...p });
  return [...byRow.values()];
}

// ---- Doors ----

/** One address to ask for one row. `alone` rows are asked in a call of their own. */
export type Knock = { n: number; name: string; address: string; url: string; tries: number; knocks: number; alone: boolean };

const notAsked = (address: string, error: string, knocks: number): DoorSign => ({ kind: "not_asked", asked: address, finalUrl: null, toHost: null, namesIt: null, title: null, chars: 0, serverDate: null, jobsLink: null, signupLink: null, error, knocks });

/** Rows whose door has not been knocked on. A row whose call failed before is asked alone, so one bad address costs one row. */
export function doorsOwed(rows: RowState[]): Knock[] {
  return rows.flatMap((r) => (r.address !== null && r.door === null && r.doorTries < TRIES ? [{ n: r.n, name: r.name, address: r.address, url: r.address, tries: r.doorTries, knocks: 1, alone: r.doorTries > 0 }] : []));
}

/** Doors that are knocked on a second time: an error, a time-out, an address that did not resolve or could not be asked. Not one that blocks readers. */
const SECOND: ReadonlySet<DoorKind> = new Set(["error", "timed_out", "gone", "not_asked"]);

/** Rows owed a second knock. After an error the address is asked under the other of http and https. */
export function secondOwed(rows: RowState[]): Knock[] {
  return rows.flatMap((r) => {
    if (r.address === null || r.door === null || !SECOND.has(r.door.kind) || r.door.knocks >= DOOR_KNOCKS || r.doorTries >= TRIES + 1) return [];
    const url = r.door.kind === "error" ? otherScheme(r.address) : r.address;
    return [{ n: r.n, name: r.name, address: r.address, url, tries: r.doorTries, knocks: 2, alone: r.doorTries > 1 }];
  });
}

/** Cuts what is owed into calls: five addresses to a call, and each `alone` one in a call of its own. */
export function intoCalls<T extends { alone: boolean }>(owed: T[]): T[][] {
  const calls: T[][] = owed.filter((o) => o.alone).map((o) => [o]);
  const together = owed.filter((o) => !o.alone);
  for (let i = 0; i < together.length; i += READS_PER_CALL) calls.push(together.slice(i, i + READS_PER_CALL));
  return calls;
}

type Asked = { ok: true; pages: Map<string, PageRead> } | { ok: false; error: string };

/** One Fetch call for a set of addresses, each asked once however many rows share it. */
async function askPages(env: Env, urls: string[]): Promise<Asked> {
  const unique = [...new Set(urls)];
  const read = await readPages(env, unique);
  if (!read.ok) return read;
  return { ok: true, pages: new Map(read.pages.map((p, i) => [unique[i]!, p])) };
}

/** What becomes of a row whose door could not be asked this time. */
function doorMissed(k: Knock, error: string): RowPatch {
  const tries = k.tries + 1;
  // A first knock that was never answered ends as "could not be asked". A second leaves the first answer standing.
  return k.knocks === 1 && tries >= TRIES ? { n: k.n, doorTries: tries, door: notAsked(k.address, error, 1) } : { n: k.n, doorTries: tries };
}

export type Knocked = { patches: RowPatch[]; read: number };

/** Knocks on the doors of one call. */
export async function knock(env: Env, call: Knock[]): Promise<Knocked> {
  const asked = await askPages(env, call.map((k) => k.url));
  if (!asked.ok) return { patches: call.map((k) => doorMissed(k, asked.error)), read: 0 };
  let read = 0;
  const counted = new Set<string>();
  const patches = call.map((k): RowPatch => {
    const page = asked.pages.get(k.url);
    if (page === undefined || (!page.ok && page.error === NOT_ANSWERED)) return doorMissed(k, NOT_ANSWERED);
    if (page.ok && !counted.has(k.url)) {
      counted.add(k.url);
      read++;
    }
    return { n: k.n, doorTries: k.tries + 1, door: readDoor(page, k.name, k.address, k.knocks) };
  });
  return { patches, read };
}

/** A call whose step broke even on its second try: a try is counted for each of its rows. */
export function knockBroke(call: Knock[]): Knocked {
  return { patches: call.map((k) => doorMissed(k, "step_failed")), read: 0 };
}

// ---- New pages ----

/** The site a row's new pages are looked for on: its own, or the one its address now leads to when that names it. */
export function hostFor(row: RowState): string {
  const door = row.door;
  return door !== null && door.kind === "forwards" && door.namesIt === true && door.toHost !== null ? door.toHost : hostOf(row.address ?? "");
}

/** Rows whose new pages are still to be asked: every row with an address, once its door has been knocked on. */
export function searchOwed(rows: RowState[]): RowState[] {
  return rows.filter((r) => r.address !== null && r.door !== null && (r.pages === null || !r.pages.done) && r.pagesTries < TRIES);
}

/** After a second knock: rows whose address now leads elsewhere are asked about that site, from the start. */
export function retarget(rows: RowState[]): RowPatch[] {
  return rows.flatMap((r) => (r.address !== null && r.pages !== null && r.pages.host !== hostFor(r) ? [{ n: r.n, pages: newAsk(hostFor(r)), pagesTries: 0 }] : []));
}

function searchMissed(row: RowState, sign: PagesSign, error: string): RowPatch {
  const tries = row.pagesTries + 1;
  return { n: row.n, pagesTries: tries, pages: tries >= TRIES ? { ...sign, done: true, failed: error } : sign };
}

/** Asks Search for the next window of one row. */
export async function ask(env: Env, row: RowState, today: string): Promise<RowPatch> {
  const sign = row.pages ?? newAsk(hostFor(row));
  const window = nextWindow(sign);
  if (window === null) return { n: row.n, pages: { ...sign, done: true } };
  const found = await searchSite(env, row.name, sign.host, windowDates(window, today));
  if (!found.ok) return searchMissed(row, sign, found.error);
  // On a site that is not the company's own, only pages that name it count.
  const name = sign.host === hostOf(row.address ?? "") ? undefined : row.name;
  return { n: row.n, pages: afterAsk(sign, window, found.results, today, name) };
}

export function askBroke(row: RowState): RowPatch {
  return searchMissed(row, row.pages ?? newAsk(hostFor(row)), "step_failed");
}

// ---- Reading ----

const item = (kind: ReadKind, url: string): ReadItem => ({ kind, url, done: false, ok: false, finalUrl: null, title: null, pageDate: null, namesIt: null, error: null, tries: 0 });

/**
 * Chooses the pages to read for the rows that have none chosen yet: the newest page Search
 * listed, the jobs page and the sign-up page. A row whose door already decides it (the
 * address is gone, for sale, or leads to a site that does not name it) has nothing to read.
 */
export function planReads(rows: RowState[]): RowPatch[] {
  return rows.flatMap((r) => {
    if (r.reads !== null) return [];
    const door = r.door;
    const kind = door?.kind ?? "no_address";
    const open = kind === "answers" || (kind === "forwards" && door?.namesIt === true);
    const decided = kind === "gone" || kind === "for_sale" || kind === "no_address" || (kind === "forwards" && door?.namesIt !== true);
    const reads: ReadItem[] = [];
    if (!decided && r.pages?.newest) reads.push(item("hit", r.pages.newest.url));
    if (open && door?.jobsLink) reads.push(item("jobs", door.jobsLink));
    if (open && door?.signupLink) reads.push(item("signup", door.signupLink));
    return [{ n: r.n, reads }];
  });
}

/** One page to read for one row. */
export type Reading = { n: number; kind: ReadKind; url: string; name: string; home: string; tries: number; alone: boolean };

export function readsOwed(rows: RowState[]): Reading[] {
  return rows.flatMap((r) =>
    (r.reads ?? []).flatMap((it) => (!it.done && it.tries < TRIES ? [{ n: r.n, kind: it.kind, url: it.url, name: r.name, home: `https://${hostFor(r)}/`, tries: it.tries, alone: it.tries > 0 }] : [])),
  );
}

export type ReadResult = { n: number; kind: ReadKind; item: ReadItem };

function readMissed(r: Reading, error: string): ReadResult {
  const tries = r.tries + 1;
  return { n: r.n, kind: r.kind, item: { ...item(r.kind, r.url), tries, done: tries >= TRIES, error: tries >= TRIES ? error : null } };
}

/** Reads the pages of one call. */
export async function readItems(env: Env, call: Reading[]): Promise<{ results: ReadResult[]; read: number }> {
  const asked = await askPages(env, call.map((r) => r.url));
  if (!asked.ok) return { results: call.map((r) => readMissed(r, asked.error)), read: 0 };
  let read = 0;
  const counted = new Set<string>();
  const results = call.map((r): ReadResult => {
    const page = asked.pages.get(r.url);
    if (page === undefined || (!page.ok && page.error === NOT_ANSWERED)) return readMissed(r, NOT_ANSWERED);
    const base = { ...item(r.kind, r.url), tries: r.tries + 1, done: true };
    if (!page.ok) return { n: r.n, kind: r.kind, item: { ...base, error: page.error } };
    if (!counted.has(r.url)) {
      counted.add(r.url);
      read++;
    }
    // A page that is not on the company's own site counts only when it names the company.
    const namesIt = sameSite(page.finalUrl, r.home) ? null : namesCompany(`${page.title ?? ""}\n${page.text}`, r.name);
    return { n: r.n, kind: r.kind, item: { ...base, ok: true, finalUrl: page.finalUrl, title: page.title, pageDate: page.pageDate, namesIt } };
  });
  return { results, read };
}

export function readBroke(call: Reading[]): { results: ReadResult[]; read: number } {
  return { results: call.map((r) => readMissed(r, "step_failed")), read: 0 };
}

/**
 * Lays what was read over the rows' lists of pages. When the newest page's own date falls
 * outside the window Search found it in, the next page Search listed is read as well.
 */
export function afterReads(rows: RowState[], results: ReadResult[], today: string): RowPatch[] {
  const touched = new Set(results.map((r) => r.n));
  return rows.flatMap((row) => {
    if (!touched.has(row.n) || row.reads === null) return [];
    const reads = row.reads.map((it) => results.find((r) => r.n === row.n && r.kind === it.kind)?.item ?? it);
    const hit = reads.find((it) => it.kind === "hit");
    const second = row.pages?.second;
    if (hit?.done && hit.ok && hit.pageDate !== null && second && row.pages?.found && windowOf(hit.pageDate, today) !== row.pages.found && !reads.some((it) => it.kind === "hit2")) {
      reads.splice(reads.indexOf(hit) + 1, 0, item("hit2", second.url));
    }
    return [{ n: row.n, reads }];
  });
}

// ---- Asking leave: the day's pages and the minute's searches ----

/** The next midnight UTC, and a few seconds, as a time and as a wait from `now`. */
function midnightAfter(now: Date): { wakeAt: string; waitMs: number } {
  const wake = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 5);
  return { wakeAt: new Date(wake).toISOString(), waitMs: wake - now.getTime() };
}

export type MayRead = { go: boolean; pages: number; waitMs: number; today: string };

/**
 * Asks leave to read `want` pages. `go` is false when this run no longer belongs to the list.
 * When the day's pages are read, the list is marked as waiting, with the time it carries on.
 */
export async function mayRead(env: Env, listId: string, attempt: number, want: number, now: Date): Promise<MayRead> {
  const today = dayNow(now);
  const at = await standing(env, listId, today);
  if (at.attempt !== attempt || at.status === "done") return { go: false, pages: 0, waitMs: 0, today };
  if (at.readsLeft <= 0) {
    const { wakeAt, waitMs } = midnightAfter(now);
    await patchList(env.DB, listId, { status: "waiting", wakeAt, note: "Today's pages are read. Knock carries on at midnight UTC." });
    return { go: true, pages: 0, waitMs, today };
  }
  if (at.status === "waiting") await patchList(env.DB, listId, { status: "working", wakeAt: null, movedAt: now.toISOString() });
  return { go: true, pages: Math.min(want, at.readsLeft), waitMs: 0, today };
}

/** `waitMs` is how long until the next minute begins (or, with `midnight`, the next day): the leg sleeps that long before it asks again. */
export type MaySearch = { go: boolean; granted: number; waitMs: number; midnight: boolean; today: string };

/** Asks leave for `want` searches: seven a minute across all lists, and no more than the day's allowance. */
export async function maySearch(env: Env, listId: string, attempt: number, want: number, now: Date): Promise<MaySearch> {
  const today = dayNow(now);
  const minute = now.toISOString().slice(11, 16);
  const took = await takeSearches(env.DB, listId, today, minute, want, SEARCHES_PER_MINUTE);
  const mine = took.attempt === attempt && took.status !== "done";
  const dayLeft = Math.max(SEARCHES_PER_DAY - took.dayUsed, 0);
  const granted = mine ? Math.min(took.granted, dayLeft) : 0;
  // Slots the minute gave that will not be used are given back.
  if (took.granted > granted) await giveBack(env.DB, today, `search:${minute}`, took.granted - granted);
  if (!mine) return { go: false, granted: 0, waitMs: 0, midnight: false, today };
  if (dayLeft === 0) {
    const { wakeAt, waitMs } = midnightAfter(now);
    await patchList(env.DB, listId, { status: "waiting", wakeAt, note: "Today's searches are used. Knock carries on at midnight UTC." });
    return { go: true, granted: 0, waitMs, midnight: true, today };
  }
  if (granted > 0 && took.status === "waiting") await patchList(env.DB, listId, { status: "working", wakeAt: null, movedAt: now.toISOString() });
  return { go: true, granted, waitMs: 60_000 - (now.getTime() % 60_000) + 1000, midnight: false, today };
}

// ---- Saving and deciding ----

/**
 * Saves what a turn learned, and counts the pages it read and the searches it asked. Pages
 * beyond the day's free ones are booked.
 */
export async function saveTurn(env: Env, listId: string, patches: RowPatch[], did: { read?: number; searched?: number }, note: string, now: Date): Promise<void> {
  const stamp = now.toISOString();
  const day = dayNow(now);
  const read = did.read ?? 0;
  const more = [
    ...(read > 0 ? [countReads(env.DB, day, read), ...(spendCap(env) > 0 ? [bookReads(env.DB, day, read, stamp, listId)] : [])] : []),
    ...((did.searched ?? 0) > 0 ? [countSearches(env.DB, day, did.searched ?? 0)] : []),
  ];
  await saveRows(env.DB, listId, merged(patches), stamp, more, note);
}

/** The verdict of every row of the group that has none yet. */
export function decideGroup(rows: RowState[], today: string): RowPatch[] {
  return rows.flatMap((r) => {
    if (r.verdict !== null) return [];
    const d = decide({ name: r.name, address: r.address, door: r.door, pages: r.pages, reads: r.reads ?? [], outside: r.outside }, today);
    return [{ n: r.n, verdict: d.verdict, rule: d.rule, lastSeen: d.lastSeen, lastSeenFrom: d.lastSeenFrom, why: d.why, evidence: d.evidence, checkedOn: today }];
  });
}

/**
 * Writes a group's verdicts and draws the wall again. After the last group, a list with a
 * verdict on every row is done. False when this run no longer belongs to the list.
 */
export async function finishGroup(env: Env, listId: string, attempt: number, patches: RowPatch[], note: string, last: boolean, now: Date): Promise<boolean> {
  const list = await getList(env.DB, listId);
  if (list === null || list.attempt !== attempt || list.status === "done") return false;
  await saveRows(env.DB, listId, patches, now.toISOString(), [], note);
  await refreshWall(env.DB, listId);
  if (last && (await rowsLeft(env.DB, listId)).left === 0) await patchList(env.DB, listId, { status: "done", note: "", wakeAt: null, finishedAt: now.toISOString() });
  return true;
}
