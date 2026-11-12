// The Cloudflare Workflow that works a list, one leg to a run. It only adapts the platform's
// step to the small interface runLeg needs, and starts the run for the next leg; all the
// work is in run.ts and stages.ts.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { STEP_TRIES } from "../core/limits";
import type { Env } from "../env";
import { FIRST_LEG, runLeg, type Leg } from "./run";

/** `leg` is absent on the run that begins a list. */
export type ListParams = { listId: string; attempt: number; leg?: Leg };

// A step that fails is tried once more. A leg's 18 calls then stay under the 50 requests a run may make.
const STEP = { retries: { limit: STEP_TRIES - 1, delay: "5 seconds", backoff: "constant" }, timeout: "3 minutes" } as const;

/**
 * The id of the run that carries a leg. It is built from the list, the attempt and the leg, so
 * a hand-over that is tried twice cannot start two runs, and "Carry on", which raises the
 * attempt, can start a run where an older one died.
 */
export function legId(listId: string, attempt: number, leg: Leg): string {
  return `${listId}-a${attempt}-g${leg.group}-${leg.stage}-${leg.turn}`;
}

/** Starts the run that carries `leg`. A run that exists already is left alone. */
export async function handOver(env: Env, listId: string, attempt: number, leg: Leg): Promise<void> {
  const id = legId(listId, attempt, leg);
  try {
    await env.LIST_WORKFLOW.create({ id, params: { listId, attempt, leg } });
  } catch (err) {
    // An earlier try may have started the run before it failed. If the run is there, all is well.
    try {
      await (await env.LIST_WORKFLOW.get(id)).status();
    } catch {
      throw err;
    }
  }
}

export class ListWorkflow extends WorkflowEntrypoint<Env, ListParams> {
  async run(event: WorkflowEvent<ListParams>, step: WorkflowStep): Promise<void> {
    const { listId, attempt, leg } = event.payload;
    await runLeg(this.env, listId, attempt, leg ?? FIRST_LEG, {
      do: <T>(name: string, fn: () => Promise<T>) => step.do(name, STEP, fn as () => Promise<never>) as Promise<T>,
      sleep: (name, ms) => step.sleep(name, ms),
      handOver: (next) => step.do(`hand over to ${legId(listId, attempt, next)}`, STEP, () => handOver(this.env, listId, attempt, next)),
    });
  }
}
