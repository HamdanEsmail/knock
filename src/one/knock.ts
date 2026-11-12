// "Knock on one door": the free signs of one address, asked while the visitor waits. It is
// the same work a list does for a row (the door, new pages, the pages to read, the verdict),
// done in one go and kept nowhere.
import { cleanAddress, hostOf, siteOf } from "../core/address";
import { dayNow } from "../core/dates";
import { KNOCKS_PER_DAY, KNOCKS_PER_VISITOR_PER_HOUR, SEARCHES_PER_MINUTE } from "../core/limits";
import { decide } from "../core/verdict";
import type { Env } from "../env";
import { afterReads, apply, ask, askBroke, doorsOwed, intoCalls, knock, knockBroke, planReads, readBroke, readItems, readsOwed, retarget, searchOwed, secondOwed } from "../list/stages";
import { bookReads, countReads, countSearches, giveBack, readsLeft, spendCap, takeMany, takeSlot, type FullRow, type RowState } from "../list/store";

/** The most pages one knock reads: the door twice at most, then the newest page, a second one, the jobs and the sign-up page. */
const PAGES_AT_MOST = 6;
/** Windows of time Search is asked about for one knock: the last year, then the two before it. */
const WINDOWS = 2;

export type OneRefused = { ok: false; status: number; code: string; message: string };
export type OneKnock = { ok: true; row: FullRow; searchBusy: boolean } | OneRefused;

const refuse = (status: number, code: string, message: string): OneRefused => ({ ok: false, status, code, message });

/** A name to look for on pages the address leads to: the site's own first label, "stripe.com" as "Stripe". */
function nameFor(address: string): string {
  const label = siteOf(hostOf(address)).split(".")[0] ?? "";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Knocks on one door. `visitor` is a key that stands for the visitor without naming them, or
 * null when it is me. Every page read and every search asked is counted like a list's.
 */
export async function knockOnce(env: Env, raw: string, visitor: string | null, now: Date): Promise<OneKnock> {
  const address = cleanAddress(raw);
  if (address === null) return refuse(400, "bad_address", "That is not a web address Knock can ask. Type one like stripe.com.");
  const today = dayNow(now);
  if ((await readsLeft(env, today)) < PAGES_AT_MOST) return refuse(429, "pages_used", "Today's pages are read. Knock answers again after midnight UTC.");
  if (visitor !== null) {
    if (!(await takeSlot(env.DB, today, "knocks", KNOCKS_PER_DAY))) return refuse(429, "knocks_used", "Knock has answered as many single doors as it does in a day. It opens again at midnight UTC.");
    if (!(await takeSlot(env.DB, now.toISOString().slice(0, 13), `knock:${visitor}`, KNOCKS_PER_VISITOR_PER_HOUR))) {
      await giveBack(env.DB, today, "knocks");
      return refuse(429, "too_many_knocks", `That is ${KNOCKS_PER_VISITOR_PER_HOUR} doors in this hour, which is all Knock answers for one visitor. Try again next hour.`);
    }
  }

  let rows: RowState[] = [{ n: 0, name: nameFor(address), address, door: null, doorTries: 0, pages: null, pagesTries: 0, reads: null, outside: null, verdict: null }];
  let read = 0;
  let searched = 0;
  let searchBusy = false;
  const minute = `search:${now.toISOString().slice(11, 16)}`;

  const knockAt = async (owed: typeof doorsOwed): Promise<void> => {
    for (const call of intoCalls(owed(rows))) {
      const got = await knock(env, call).catch(() => knockBroke(call));
      rows = apply(rows, got.patches);
      read += got.read;
    }
  };
  // One slot of the minute is kept for a knock, beyond the seven a list may use.
  const search = async (): Promise<void> => {
    for (let i = 0; i < WINDOWS && searchOwed(rows).length > 0; i++) {
      if ((await takeMany(env.DB, today, minute, 1, SEARCHES_PER_MINUTE + 1)) === 0) {
        searchBusy = true;
        return;
      }
      const row = rows[0]!;
      rows = apply(rows, [await ask(env, row, today).catch(() => askBroke(row))]);
      searched++;
    }
  };

  await knockAt(doorsOwed);
  await search();
  await knockAt(secondOwed);
  const moved = retarget(rows);
  if (moved.length > 0) {
    rows = apply(rows, moved);
    await search();
  }
  rows = apply(rows, planReads(rows));
  for (let turn = 0; turn < 2; turn++) {
    const owed = readsOwed(rows);
    if (owed.length === 0) break;
    const got = await Promise.all(intoCalls(owed).map((call) => readItems(env, call).catch(() => readBroke(call))));
    rows = apply(rows, afterReads(rows, got.flatMap((g) => g.results), today));
    read += got.reduce((sum, g) => sum + g.read, 0);
  }

  const stamp = now.toISOString();
  const counts = [
    ...(read > 0 ? [countReads(env.DB, today, read), ...(spendCap(env) > 0 ? [bookReads(env.DB, today, read, stamp, "one door")] : [])] : []),
    ...(searched > 0 ? [countSearches(env.DB, today, searched)] : []),
  ];
  if (counts.length > 0) await env.DB.batch(counts);

  const r = rows[0]!;
  const d = decide({ name: r.name, address: r.address, door: r.door, pages: r.pages, reads: r.reads ?? [], outside: null }, today);
  return {
    ok: true,
    searchBusy,
    row: { ...r, verdict: d.verdict, cells: [], rule: d.rule, lastSeen: d.lastSeen, lastSeenFrom: d.lastSeenFrom, why: d.why, evidence: d.evidence, checkedOn: today },
  };
}

/** A key for a visitor that cannot be turned back into their address. */
export async function visitorKey(env: Env, ip: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${env.ADMIN_TOKEN}:${ip}`)));
  return [...bytes.slice(0, 10)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
