// The Cloudflare Workflow that works a list, one leg to a run.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "../env";

export type ListParams = { listId: string; attempt: number };

export class ListWorkflow extends WorkflowEntrypoint<Env, ListParams> {
  async run(_event: WorkflowEvent<ListParams>, _step: WorkflowStep): Promise<void> {}
}
