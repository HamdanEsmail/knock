// A list is worked in legs. A leg is one Workflow run: it takes one group of rows as far
// through its stages as 18 outside calls allow, then hands the rest on to a fresh run. The
// free plan allows a run 50 requests to other hosts and 50 database queries, and a step is
// tried twice at most, so a leg stays inside both.
//
// A Workflow may run a leg again from the top with the results of finished steps remembered.
// So everything that steers a leg comes out of a step: the rows, the leave to read or search,
// the time. Nothing here reads the clock or the database outside a step.
import { CALLS_AT_ONCE, CALLS_PER_LEG, GROUP_ROWS, QUERIES_PER_LEG, SEARCHES_PER_MINUTE } from "../core/limits";
import type { Env } from "../env";
import {
  STAGES,
  afterReads,
  apply,
  ask,
  askBroke,
  begin,
  decideGroup,
  doorsOwed,
  finishGroup,
  intoCalls,
  knock,
  knockBroke,
  mayRead,
  maySearch,
  planReads,
  readBroke,
  readItems,
  readsOwed,
  retarget,
  saveTurn,
  searchOwed,
  secondOwed,
  type Knock,
  type Reading,
  type Stage,
} from "./stages";
import type { RowPatch } from "./store";

/** Where a leg takes up the work: a group of rows, a stage, and how many legs this stage of this group has had. */
export type Leg = { group: number; stage: Stage; turn: number };

export const FIRST_LEG: Leg = { group: 0, stage: "doors", turn: 0 };

/** The part of a Workflow step a leg needs. `handOver` starts the run for the next leg. */
export type ListStep = {
  do<T>(name: string, fn: () => Promise<T>): Promise<T>;
  sleep(name: string, ms: number): Promise<void>;
  handOver(next: Leg): Promise<void>;
};

const NOTES: Record<Stage, string> = {
  doors: "Knocking on doors",
  search: "Asking Search for new pages",
  doors2: "Knocking a second time where nobody answered",
  search2: "Asking Search about the addresses that moved",
  read: "Reading the pages it found",
  verdict: "Deciding",
};

/**
 * The most database queries each piece of a leg can make: asking leave and saving a turn of
 * pages; asking leave and saving a turn of searches; a plain save; deciding a group.
 */
const COST = { begin: 2, pageTurn: 7, searchTurn: 9, save: 2, verdict: 8 } as const;

export async function runLeg(env: Env, listId: string, attempt: number, leg: Leg, step: ListStep, clock: () => Date = () => new Date()): Promise<void> {
  const begun = await step.do(`begin g${leg.group} ${leg.stage} ${leg.turn}`, () => begin(env, listId, attempt, leg.group, clock()));
  if (begun === null) return;
  let rows = begun.rows;
  let today = begun.today;
  const total = begun.rowCount;
  const last = (leg.group + 1) * GROUP_ROWS >= total;
  const next: Leg = { group: leg.group + 1, stage: "doors", turn: 0 };
  // A group that is already decided, as after "Carry on", is passed over.
  if (rows.length === 0 || rows.every((r) => r.verdict !== null)) {
    if (!last) return await step.handOver(next);
    await step.do(`close g${leg.group}`, () => finishGroup(env, listId, attempt, [], "", true, clock()));
    return;
  }

  const range = `rows ${leg.group * GROUP_ROWS + 1} to ${Math.min((leg.group + 1) * GROUP_ROWS, total)} of ${total}`;
  let calls = 0;
  let seq = 0;
  // What the leg's database work may have cost so far, at most. Beginning a leg reads the list and its group.
  let queries = COST.begin;
  const afford = (cost: number): boolean => queries + cost <= QUERIES_PER_LEG;

  /** Reads pages for a stage until it owes none. "full" when the leg has no calls or queries left, "stop" when the run is no longer the list's. */
  const pages = async (stage: Stage, owed: () => (Knock | Reading)[]): Promise<"done" | "full" | "stop"> => {
    for (;;) {
      const waiting = owed();
      if (waiting.length === 0) return "done";
      const room = CALLS_PER_LEG - calls;
      if (room <= 0 || !afford(COST.pageTurn)) return "full";
      queries += COST.pageTurn;
      let turn = intoCalls(waiting).slice(0, Math.min(CALLS_AT_ONCE, room));
      const n = ++seq;
      const may = await step.do(`may read ${stage} ${n}`, () => mayRead(env, listId, attempt, turn.flat().length, clock()));
      if (!may.go) return "stop";
      today = may.today;
      if (may.pages === 0) {
        await step.sleep(`wait for the day's pages ${n}`, may.waitMs);
        continue;
      }
      // Only as many pages as the day still allows.
      let left = may.pages;
      turn = turn.flatMap((call) => {
        const part = call.slice(0, left);
        left -= part.length;
        return part.length > 0 ? [part] : [];
      });
      calls += turn.length;

      const patches: RowPatch[] = [];
      let read = 0;
      if (stage === "read") {
        const got = await Promise.all((turn as Reading[][]).map((call, i) => step.do(`read ${n}.${i + 1}`, () => readItems(env, call)).catch(() => readBroke(call))));
        read = got.reduce((sum, g) => sum + g.read, 0);
        patches.push(...afterReads(rows, got.flatMap((g) => g.results), today));
      } else {
        const got = await Promise.all((turn as Knock[][]).map((call, i) => step.do(`knock ${stage} ${n}.${i + 1}`, () => knock(env, call)).catch(() => knockBroke(call))));
        read = got.reduce((sum, g) => sum + g.read, 0);
        patches.push(...got.flatMap((g) => g.patches));
      }
      rows = apply(rows, patches);
      await step.do(`save ${stage} ${n}`, () => saveTurn(env, listId, patches, { read }, `${NOTES[stage]}: ${range}.`, clock()));
    }
  };

  /**
   * Asks Search for a stage until it owes none: seven a minute across all lists. After a turn
   * the leg sleeps into the next minute before it asks leave again, so no leave is asked in vain.
   */
  const searches = async (stage: Stage, carried: RowPatch[]): Promise<"done" | "full" | "stop"> => {
    const note = `${NOTES[stage]}: ${range}.`;
    let unsaved = carried;
    for (;;) {
      const waiting = searchOwed(rows);
      const room = CALLS_PER_LEG - calls;
      if (waiting.length === 0 || room <= 0 || !afford(COST.searchTurn)) {
        if (unsaved.length > 0) await step.do(`save ${stage} ${++seq}`, () => saveTurn(env, listId, unsaved, {}, note, clock()));
        return waiting.length === 0 ? "done" : "full";
      }
      queries += COST.searchTurn;
      const n = ++seq;
      const may = await step.do(`may search ${stage} ${n}`, () => maySearch(env, listId, attempt, Math.min(waiting.length, room, SEARCHES_PER_MINUTE), clock()));
      if (!may.go) return "stop";
      today = may.today;
      if (may.granted > 0) {
        const turn = waiting.slice(0, may.granted);
        calls += turn.length;
        const asked = await Promise.all(turn.map((row) => step.do(`ask ${stage} ${n}.${row.n}`, () => ask(env, row, today)).catch(() => askBroke(row))));
        rows = apply(rows, asked);
        const patches = [...unsaved, ...asked];
        unsaved = [];
        await step.do(`save ${stage} ${n}`, () => saveTurn(env, listId, patches, { searched: turn.length }, note, clock()));
        if (searchOwed(rows).length === 0 || CALLS_PER_LEG - calls <= 0 || !afford(COST.searchTurn)) continue;
      }
      await step.sleep(may.midnight ? `wait for the day's searches ${n}` : `wait a minute ${n}`, may.waitMs);
    }
  };

  for (let s = STAGES.indexOf(leg.stage); s < STAGES.length; s++) {
    const stage = STAGES[s]!;
    let state: "done" | "full" | "stop";
    if (stage === "doors") state = await pages(stage, () => doorsOwed(rows));
    else if (stage === "doors2") state = await pages(stage, () => secondOwed(rows));
    else if (stage === "search") state = await searches(stage, []);
    else if (stage === "search2") {
      const moved = retarget(rows);
      rows = apply(rows, moved);
      state = await searches(stage, moved);
    } else if (stage === "read") {
      const planned = planReads(rows);
      if (planned.length > 0 && !afford(COST.save + COST.pageTurn)) state = "full";
      else {
        rows = apply(rows, planned);
        if (planned.length > 0) {
          queries += COST.save;
          await step.do(`plan the reading g${leg.group}`, () => saveTurn(env, listId, planned, {}, `${NOTES.read}: ${range}.`, clock()));
        }
        state = await pages(stage, () => readsOwed(rows));
      }
    } else if (!afford(COST.verdict)) state = "full";
    else {
      const verdicts = decideGroup(rows, today);
      const mine = await step.do(`decide g${leg.group}`, () => finishGroup(env, listId, attempt, verdicts, last ? "" : `Decided: ${range}.`, last, clock()));
      state = mine ? "done" : "stop";
    }
    if (state === "stop") return;
    if (state === "full") return await step.handOver({ group: leg.group, stage, turn: stage === leg.stage ? leg.turn + 1 : 0 });
  }
  if (!last) await step.handOver(next);
}
