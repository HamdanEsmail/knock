// TinySet, through TinyFish's Datasets API. Making an empty dataset is free; filling it is
// what costs, at $0.10 for each row that comes back. The shapes here are the ones the API
// answered with when I tested it on 11 November 2026.
import type { Env } from "../env";
import type { Spec } from "../outside/spec";
import { TinyFishError, readJson, tinyfishFetch } from "./client";

const API = "https://agent.tinyfish.ai/v1/datasets";
/** Pages of rows read at most. A set holds 50 rows, and one page holds 500. */
const PAGES_MAX = 4;

type Dataset = { id?: unknown; status?: unknown; row_count?: unknown; run?: { id?: unknown } | null };

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const idOf = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** Makes a dataset and fills nothing. Its id is what a fill is started on later. */
export async function makeDataset(env: Env, spec: Spec, targetRows: number): Promise<string> {
  const made = await readJson<Dataset>(await tinyfishFetch(env, API, post({ spec, target_rows: targetRows, populate: false })));
  const id = idOf(made.id);
  // A dataset that came back with a run has been started, which nobody asked for: it is not taken as empty.
  if (id === null || made.status !== "empty" || (made.run !== null && made.run !== undefined)) throw new TinyFishError(502, "bad_dataset");
  return id;
}

/** `status` is empty, populating, ready, failed or cancelled; `rows` is how many rows it holds so far. */
export type DatasetState = { status: string; rows: number; runId: string | null };

export async function readDataset(env: Env, id: string): Promise<DatasetState> {
  const got = await readJson<Dataset>(await tinyfishFetch(env, `${API}/${encodeURIComponent(id)}`, { method: "GET" }));
  if (typeof got.status !== "string" || got.status === "") throw new TinyFishError(502, "bad_dataset");
  return { status: got.status, rows: typeof got.row_count === "number" ? got.row_count : 0, runId: idOf(got.run?.id) };
}

/** Starts a fill. This is the call that costs money, so it is made once and never tried again by itself. */
export async function fillDataset(env: Env, id: string, targetRows: number): Promise<string | null> {
  const got = await readJson<Dataset>(await tinyfishFetch(env, `${API}/${encodeURIComponent(id)}/populate`, post({ target_rows: targetRows })));
  return idOf(got.run?.id);
}

/** Every row of a dataset, as the values TinySet filled in. */
export async function rowsOf(env: Env, id: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let after: string | null = null;
  for (let page = 0; page < PAGES_MAX; page++) {
    const url: string = `${API}/${encodeURIComponent(id)}/rows?limit=500${after === null ? "" : `&after=${encodeURIComponent(after)}`}`;
    const got: { rows?: unknown; truncated?: unknown; next_cursor?: unknown } = await readJson(await tinyfishFetch(env, url, { method: "GET" }));
    if (!Array.isArray(got.rows)) throw new TinyFishError(502, "bad_rows");
    for (const row of got.rows) {
      const data = typeof row === "object" && row !== null ? (row as { data?: unknown }).data : null;
      if (typeof data === "object" && data !== null && !Array.isArray(data)) rows.push(data as Record<string, unknown>);
    }
    after = got.truncated === true ? idOf(got.next_cursor) : null;
    if (after === null) break;
  }
  return rows;
}

/** Asks for a run to be stopped. Rows that were not filled are not charged. */
export async function cancelRun(env: Env, id: string, runId: string): Promise<void> {
  await tinyfishFetch(env, `${API}/${encodeURIComponent(id)}/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
}
