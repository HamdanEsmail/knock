// "Carry on": starts a list's work again where it stopped. It does so only when the list has
// not moved for ten minutes, so pressing it on a list that is working changes nothing.
import { GROUP_ROWS, STALLED_MS } from "../core/limits";
import type { Env } from "../env";
import type { Leg } from "./run";
import { getList, patchList, raiseAttempt, refreshWall, rowsLeft } from "./store";

export type Carried = "started" | "still working" | "waiting" | "done" | "not found";

/**
 * `start` begins the run for a leg under the new attempt. Raising the attempt is what stops
 * the older run: every leg checks that its attempt is still the list's before it does anything.
 */
export async function carryOn(env: Env, listId: string, now: Date, start: (attempt: number, leg: Leg) => Promise<void>): Promise<Carried> {
  const list = await getList(env.DB, listId);
  if (list === null) return "not found";
  if (list.status === "done") return "done";
  // A list that waits for midnight is not stalled: it carries on by itself.
  if (list.status === "waiting" && list.wakeAt !== null && Date.parse(list.wakeAt) > now.getTime()) return "waiting";
  if (now.getTime() - Date.parse(list.movedAt) < STALLED_MS) return "still working";
  if (!(await raiseAttempt(env.DB, listId, list.attempt, now.toISOString()))) return "still working";

  const { left, first } = await rowsLeft(env.DB, listId);
  if (left === 0 || first === null) {
    await refreshWall(env.DB, listId);
    await patchList(env.DB, listId, { status: "done", note: "", wakeAt: null, finishedAt: now.toISOString() });
    return "done";
  }
  // Rows record how far they have got, so the first group with a row left is taken up from its doors.
  await start(list.attempt + 1, { group: Math.floor(first / GROUP_ROWS), stage: "doors", turn: 0 });
  return "started";
}
