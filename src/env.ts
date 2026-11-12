// The Worker's bindings and secrets.
import type { ListParams } from "./list/workflow";
import type { SetParams } from "./outside/workflow";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** My second TinyFish account. Knock uses it for everything. */
  TINYFISH_API_KEY: string;
  ADMIN_TOKEN: string;
  /** The most that may be spent in total, in dollars. Unset or 0 means nothing paid happens. */
  SPEND_CAP_USD?: string;
  LIST_WORKFLOW: Workflow<ListParams>;
  /** The runs that put a set of rows to TinySet. */
  SET_WORKFLOW: Workflow<SetParams>;
  PUBLIC_BASE_URL: string;
};
