// A wave: one set of rows from a finished list, put to TinySet. It is the only part of Knock
// that pays for rows, so its order is fixed and every step that costs is taken once:
//
//   1. the rows are claimed and the wallet is read            (startWave; nothing is paid)
//   2. the empty dataset is made and its id saved             (free)
//   3. the fill is asked for, once                            (PAID; never asked again by itself)
//   4. the fill is looked at once a minute until it has ended
//   5. rows that did not come back get one refill             (PAID for the rows it brings)
//   6. what came back is laid over the rows, and every source link is read live
//   7. the rows' verdicts are decided again
//   8. ten minutes after the last fill ended the wallet is read, and its fall is booked
//
// Like a list, a set is worked in legs, each a Workflow run of at most 18 outside calls, and
// everything that steers a leg comes out of a step.
import { CALLS_AT_ONCE, CALLS_PER_LEG, CHARGE_LANDS_MS, EMPTY_LOOKS, LOOKS_MAX, LOOKS_PER_LEG, LOOK_EVERY_MS, QUERIES_PER_LEG, READS_USD_MAX, SET_ROWS, SET_ROW_USD } from "../core/limits";
import { dayNow } from "../core/dates";
import type { OutsideSign, ReadItem } from "../core/signs";
import { decide } from "../core/verdict";
import type { Env } from "../env";
import { afterReads, apply, intoCalls, item, midnightAfter, readBroke, readItems, readsOwed, saveTurn } from "../list/stages";
import { getList, readsLeft, refreshWall, saveRows, spendCap, type RowPatch, type RowState } from "../list/store";
import { cancelRun, fillDataset, makeDataset, readDataset, rowsOf } from "../tinyfish/datasets";
import { readBalance } from "../tinyfish/wallet";
import { NOTHING_RETURNED, matchRows } from "./match";
import { pickRows } from "./pick";
import { specFor, type SetRow } from "./spec";
import { bookSet, candidates, claimSet, countLook, getSet, loadRows, markMade, markPosted, markRead, markRefill, raiseSet, releaseSet, setBooks, type SetOutcome, type SetRecord } from "./store";

const usd = (n: number): number => Math.round(n * 1e6) / 1e6;

// ---- Starting a wave ----

/** How many rows to send, taken in the order of section 6; or exactly the rows named. */
export type WaveAsk = { count?: number; rows?: number[] };

export type Refused = { ok: false; status: number; code: string; message: string };
export type Started = { ok: true; setId: string; rows: number[]; costAtMost: number } | Refused;

const refuse = (status: number, code: string, message: string): Refused => ({ ok: false, status, code, message });

/**
 * Claims the rows of one set and starts its run. Nothing is paid for here. It refuses when
 * the set could take the spend past the cap (two dollars of which are kept for pages), when
 * the wallet cannot be read, and while another set is not yet in the books.
 */
export async function startWave(env: Env, listId: string, ask: WaveAsk, now: Date, start: (setId: string) => Promise<void>): Promise<Started> {
  const list = await getList(env.DB, listId);
  if (list === null) return refuse(404, "not_found", "There is no such list.");
  if (list.status !== "done") return refuse(409, "list_not_done", "The list is still being checked. A set starts when every row has its free signs.");
  const books = await setBooks(env.DB);
  if (books.inFlight > 0) return refuse(409, "set_in_flight", "Another set is not in the books yet. One set runs at a time, so that what each one cost can be read from the wallet.");
  const count = Math.min(Math.max(Math.trunc(ask.count ?? SET_ROWS), 1), SET_ROWS);
  const picked = pickRows(await candidates(env.DB, listId), count, ask.rows);
  if (picked.length === 0) return refuse(409, "nothing_to_send", "No row of this list is left that TinySet could add to.");
  const cost = usd(picked.length * SET_ROW_USD);
  const room = usd(spendCap(env) - READS_USD_MAX - books.bookedUsd);
  if (cost > room) return refuse(402, "cap", `These ${picked.length} rows could cost $${cost.toFixed(2)}, and $${Math.max(room, 0).toFixed(2)} is left for sets under the cap.`);
  let balance: number;
  try {
    balance = await readBalance(env);
  } catch {
    return refuse(503, "wallet_unreadable", "The wallet could not be read, so nothing was started.");
  }
  if (balance < cost) return refuse(402, "wallet_low", `The wallet holds less than the $${cost.toFixed(2)} these rows could cost.`);
  const setId = await claimSet(env.DB, listId, picked, balance, now.toISOString());
  if (setId === null) return refuse(409, "rows_taken", "Some of these rows were taken by another set meanwhile. Nothing was started.");
  try {
    await start(setId);
  } catch {
    await releaseSet(env.DB, setId, "The run could not be started. Nothing was charged.");
    return refuse(503, "could_not_start", "The set could not be started. Nothing was charged, and its rows are free again.");
  }
  return { ok: true, setId, rows: picked, costAtMost: cost };
}

/** Starts a set's work again after its run died. A fill that was asked for is never asked for again. */
export async function carryOnSet(env: Env, setId: string, _now: Date, start: (setId: string, attempt: number) => Promise<void>): Promise<"started" | "done" | "still working" | "not found"> {
  const set = await getSet(env.DB, setId);
  if (set === null) return "not found";
  if (set.status === "booked" || set.status === "failed") return "done";
  if (!(await raiseSet(env.DB, setId, set.attempt))) return "still working";
  await start(setId, set.attempt + 1);
  return "started";
}

// ---- The pieces of a leg ----

type Begun = { set: SetRecord; rows: RowState[] };

async function begin(env: Env, setId: string, attempt: number): Promise<Begun | null> {
  const set = await getSet(env.DB, setId);
  if (set === null || set.attempt !== attempt || set.status === "booked" || set.status === "failed") return null;
  return { set, rows: await loadRows(env.DB, set.listId, set.rows) };
}

/**
 * Asks for a fill, if this caller is the one that may. The right is taken in the database
 * first, so a second caller, or this step run again, asks for nothing. Before the first fill
 * the dataset is read: one that is already filling or filled is left alone.
 */
async function askFill(env: Env, set: SetRecord, datasetId: string, target: number, nth: 1 | 2): Promise<void> {
  if (!(await (nth === 1 ? markPosted(env.DB, set.id) : markRefill(env.DB, set.id)))) return;
  if (nth === 1) {
    const at = await readDataset(env, datasetId);
    if (at.status !== "empty" || at.runId !== null) return;
  }
  await fillDataset(env, datasetId, target);
}

type Look = { status: string; runId: string | null; looks: number };

async function look(env: Env, setId: string, datasetId: string): Promise<Look> {
  const at = await readDataset(env, datasetId);
  return { status: at.status, runId: at.runId, looks: await countLook(env.DB, setId) };
}

type Back = { matched: [number, OutsideSign][]; outcome: SetOutcome };

async function readBack(env: Env, datasetId: string, sent: SetRow[]): Promise<Back> {
  const m = matchRows(sent, await rowsOf(env, datasetId));
  return { matched: [...m.matched], outcome: { matched: m.matched.size, offList: m.offList, wrongSite: m.wrongSite, missing: m.missing } };
}

/** A row's pages to read, with the links TinySet gave in place of any it gave before. */
function withSources(reads: ReadItem[] | null, sign: OutsideSign): ReadItem[] {
  const kept = (reads ?? []).filter((r) => r.kind !== "source" && r.kind !== "activity");
  if (sign.outcomeSource !== null) kept.push(item("source", sign.outcomeSource));
  if (sign.activityLink !== null) kept.push(item("activity", sign.activityLink));
  return kept;
}

function laidOver(rows: RowState[], back: Back): RowPatch[] {
  const said = new Map(back.matched);
  return rows.map((r) => {
    const sign = said.get(r.n);
    return sign === undefined ? { n: r.n, outside: NOTHING_RETURNED } : { n: r.n, outside: sign, reads: withSources(r.reads, sign) };
  });
}

async function saveBack(env: Env, set: SetRecord, patches: RowPatch[], outcome: SetOutcome, now: Date): Promise<void> {
  const stamp = now.toISOString();
  await saveRows(env.DB, set.listId, patches, stamp, [markRead(env.DB, set.id, outcome, stamp)], "Reading the sources TinySet gave.");
}

async function mayRead(env: Env, now: Date): Promise<{ pages: number; waitMs: number; today: string }> {
  const today = dayNow(now);
  return { pages: await readsLeft(env, today), waitMs: midnightAfter(now).waitMs, today };
}

async function decideAgain(env: Env, set: SetRecord, rows: RowState[], now: Date): Promise<void> {
  const today = dayNow(now);
  const patches = rows.map((r): RowPatch => {
    const d = decide({ name: r.name, address: r.address, door: r.door, pages: r.pages, reads: r.reads ?? [], outside: r.outside }, today);
    return { n: r.n, verdict: d.verdict, rule: d.rule, lastSeen: d.lastSeen, lastSeenFrom: d.lastSeenFrom, why: d.why, evidence: d.evidence, checkedOn: today };
  });
  await saveRows(env.DB, set.listId, patches, now.toISOString(), [], "");
  await refreshWall(env.DB, set.listId);
}

/**
 * What a set cost: the wallet's fall, and never more than its rows at ten cents each. When
 * the wallet cannot say (it could not be read, or it rose because money was added), the rows
 * are booked at ten cents each, so the books never read low.
 */
export function costOf(before: number | null, after: number | null, rowsSent: number): number {
  const atMost = usd(rowsSent * SET_ROW_USD);
  if (before === null || after === null || after > before) return atMost;
  return Math.min(usd(before - after), atMost);
}

async function book(env: Env, setId: string, now: Date): Promise<void> {
  const set = await getSet(env.DB, setId);
  if (set === null || set.status !== "read") return;
  let after: number | null;
  try {
    after = await readBalance(env);
  } catch {
    after = null;
  }
  await bookSet(env.DB, setId, costOf(set.walletBefore, after, set.rows.length), now.toISOString());
}

// ---- A leg ----

/** The part of a Workflow step a set's leg needs. `once` is a step that is never tried a second time. */
export type SetStep = {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  once<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
  handOver(nextTurn: number): Promise<void>;
};

/** The most database queries each piece of a leg can make. */
const COST = { begin: 2, make: 1, fill: 1, look: 1, back: 3, pageTurn: 6, decide: 4, book: 4 } as const;

const ENDED = new Set(["ready", "failed", "cancelled"]);

export async function runSet(env: Env, setId: string, attempt: number, turn: number, step: SetStep, clock: () => Date = () => new Date()): Promise<void> {
  const begun = await step.do(`begin ${turn}`, () => begin(env, setId, attempt));
  if (begun === null) return;
  let { set, rows } = begun;
  const sent: SetRow[] = rows.map((r) => ({ n: r.n, name: r.name, address: r.address }));
  let calls = 0;
  let queries: number = COST.begin;
  const room = (outside: number, cost: number): boolean => calls + outside <= CALLS_PER_LEG && queries + cost <= QUERIES_PER_LEG;

  if (set.status === "claimed") {
    const datasetId = await step.do("make the dataset", async () => {
      const id = await makeDataset(env, specFor(sent), sent.length);
      await markMade(env.DB, set.id, id);
      return id;
    });
    set = { ...set, status: "made", datasetId };
    calls += 1;
    queries += COST.make;
  }
  const datasetId = set.datasetId;
  if (datasetId === null) return;

  if (set.status === "made") {
    // The paid call. It is never tried a second time: a fill that was lost costs nothing, one made twice costs double.
    await step.once("ask for the fill", () => askFill(env, set, datasetId, sent.length, 1)).catch(() => undefined);
    set = { ...set, status: "posted", fills: 1 };
    calls += 2;
    queries += COST.fill;
  }

  let looked = 0;
  while (set.status === "posted") {
    if (looked >= LOOKS_PER_LEG || !room(3, COST.look + COST.back)) return await step.handOver(turn + 1);
    const n = ++looked;
    await step.sleep(`wait ${n}`, LOOK_EVERY_MS);
    const at = await step.do(`look ${n}`, () => look(env, set.id, datasetId));
    calls += 1;
    queries += COST.look;
    if (at.status === "empty" && at.runId === null && set.fills === 1) {
      if (at.looks < EMPTY_LOOKS) continue;
      await step.do("give the rows back", () => releaseSet(env.DB, set.id, "The fill did not start. Nothing was charged, and the rows are free again."));
      return;
    }
    let ended = ENDED.has(at.status);
    if (!ended && at.looks >= LOOKS_MAX) {
      const runId = at.runId;
      if (runId !== null) await step.do("stop the fill", () => cancelRun(env, datasetId, runId)).catch(() => undefined);
      calls += 1;
      ended = true;
    }
    if (!ended) continue;

    const back = await step.do(`read the rows ${n}`, () => readBack(env, datasetId, sent));
    calls += 1;
    if (back.outcome.missing.length > 0 && set.fills === 1 && at.status === "ready") {
      await step.once("ask for the refill", () => askFill(env, set, datasetId, sent.length, 2)).catch(() => undefined);
      set = { ...set, fills: 2 };
      calls += 1;
      queries += COST.fill;
      continue;
    }
    const patches = laidOver(rows, back);
    await step.do("save what came back", () => saveBack(env, set, patches, back.outcome, clock()));
    queries += COST.back;
    rows = apply(rows, patches);
    set = { ...set, status: "read" };
  }

  // Every source link is read live before it counts.
  let seq = 0;
  for (;;) {
    const owed = readsOwed(rows);
    if (owed.length === 0) break;
    if (!room(1, COST.pageTurn + COST.decide)) return await step.handOver(turn + 1);
    const n = ++seq;
    const may = await step.do(`may read ${n}`, () => mayRead(env, clock()));
    queries += COST.pageTurn;
    if (may.pages === 0) {
      await step.sleep(`wait for the day's pages ${n}`, may.waitMs);
      continue;
    }
    let left = may.pages;
    const reading = intoCalls(owed)
      .slice(0, Math.min(CALLS_AT_ONCE, CALLS_PER_LEG - calls))
      .flatMap((call) => {
        const part = call.slice(0, left);
        left -= part.length;
        return part.length > 0 ? [part] : [];
      });
    calls += reading.length;
    const got = await Promise.all(reading.map((call, i) => step.do(`read ${n}.${i + 1}`, () => readItems(env, call)).catch(() => readBroke(call))));
    const patches = afterReads(rows, got.flatMap((g) => g.results), may.today);
    rows = apply(rows, patches);
    const read = got.reduce((sum, g) => sum + g.read, 0);
    await step.do(`save reads ${n}`, () => saveTurn(env, set.listId, patches, { read }, "Reading the sources TinySet gave.", clock()));
  }

  if (!room(1, COST.decide + COST.book)) return await step.handOver(turn + 1);
  await step.do("decide again", () => decideAgain(env, set, rows, clock()));
  const wait = await step.do("when the charge will have landed", async () => {
    const ended = (await getSet(env.DB, set.id))?.endedAt;
    return ended ? Math.max(Date.parse(ended) + CHARGE_LANDS_MS - clock().getTime(), 0) : CHARGE_LANDS_MS;
  });
  if (wait > 0) await step.sleep("wait for the charge to land", wait);
  await step.do("book", () => book(env, set.id, clock()));
}
