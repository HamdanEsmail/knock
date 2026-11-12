// The Cloudflare Workflow that works a set, one leg to a run. It only adapts the platform's
// step to the small interface runSet needs; all the work is in wave.ts.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { STEP_TRIES } from "../core/limits";
import type { Env } from "../env";
import { runSet } from "./wave";

export type SetParams = { setId: string; attempt: number; turn: number };

// A step that fails is tried once more.
const STEP = { retries: { limit: STEP_TRIES - 1, delay: "5 seconds", backoff: "constant" }, timeout: "3 minutes" } as const;
// The step that asks for a paid fill is tried once and never again. `limit` counts the tries
// after the first, and whatever the step throws is thrown on as the error Workflows never
// retries, so the one try holds on both counts. runSet catches it and carries on.
const ONCE = { retries: { limit: 0, delay: "1 second", backoff: "constant" }, timeout: "2 minutes" } as const;
const never = (err: unknown): never => {
  throw new NonRetryableError(err instanceof Error ? err.message : "the step failed");
};

/** The id of the run that carries a leg of a set. It is fixed, so a hand-over tried twice starts one run. */
export function setRunId(setId: string, attempt: number, turn: number): string {
  return `${setId}-a${attempt}-t${turn}`;
}

/** Starts the run for a leg of a set. A run that exists already is left alone. */
export async function startSetRun(env: Env, setId: string, attempt: number, turn: number): Promise<void> {
  const id = setRunId(setId, attempt, turn);
  try {
    await env.SET_WORKFLOW.create({ id, params: { setId, attempt, turn } });
  } catch (err) {
    // An earlier try may have started the run before it failed. If the run is there, all is well.
    try {
      await (await env.SET_WORKFLOW.get(id)).status();
    } catch {
      throw err;
    }
  }
}

export class SetWorkflow extends WorkflowEntrypoint<Env, SetParams> {
  async run(event: WorkflowEvent<SetParams>, step: WorkflowStep): Promise<void> {
    const { setId, attempt, turn } = event.payload;
    await runSet(this.env, setId, attempt, turn, {
      do: <T>(name: string, fn: () => Promise<T>) => step.do(name, STEP, fn as () => Promise<never>) as Promise<T>,
      once: <T>(name: string, fn: () => Promise<T>) => step.do(name, ONCE, (() => fn().catch(never)) as () => Promise<never>) as Promise<T>,
      sleep: (name, ms) => step.sleep(name, ms),
      handOver: (next) => step.do(`hand over to ${setRunId(setId, attempt, next)}`, STEP, () => startSetRun(this.env, setId, attempt, next)),
    });
  }
}
