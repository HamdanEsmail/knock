// Decides a finished list again from the signs it already holds. The verdict is a pure
// function of the signs, so when a rule changes nothing has to be asked a second time: the
// stored signs are read and today's rules are applied to them.
//
// Each row is decided as of the day it was checked, and that day is kept. Its sentences say
// "read today", and that is true of the day on the row, not of the day the rules were changed.
import { dayNow } from "../core/dates";
import { ROWS_MAX } from "../core/limits";
import { decide } from "../core/verdict";
import type { Env } from "../env";
import { signsOf } from "./csv-out";
import { getList, listRows, refreshWall, saveRows, type RowPatch } from "./store";

/** Rows written in one statement. */
const ROWS_PER_SAVE = 200;

const same = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export async function decideListAgain(env: Env, listId: string, now: Date): Promise<{ rows: number; decided: number; changed: number } | "not found" | "not done"> {
  const list = await getList(env.DB, listId);
  if (list === null) return "not found";
  if (list.status !== "done") return "not done";
  const rows = await listRows(env.DB, listId, { from: 0, count: ROWS_MAX });
  const decided = rows.filter((r) => r.verdict !== null);
  const patches: RowPatch[] = [];
  for (const r of decided) {
    const d = decide(signsOf(r), r.checkedOn ?? dayNow(now));
    if (d.verdict === r.verdict && d.rule === r.rule && d.why === r.why && d.lastSeen === r.lastSeen && d.lastSeenFrom === r.lastSeenFrom && same(d.evidence, r.evidence)) continue;
    patches.push({ n: r.n, verdict: d.verdict, rule: d.rule, lastSeen: d.lastSeen, lastSeenFrom: d.lastSeenFrom, why: d.why, evidence: d.evidence });
  }
  // The list's "moved" time is left alone: nothing was knocked on.
  for (let i = 0; i < patches.length; i += ROWS_PER_SAVE) await saveRows(env.DB, listId, patches.slice(i, i + ROWS_PER_SAVE), list.movedAt);
  if (patches.length > 0) await refreshWall(env.DB, listId);
  return { rows: rows.length, decided: decided.length, changed: patches.length };
}
