// TinyFish Search, limited to one site: the dated pages the index lists there.
import type { Env } from "../env";
import { codeOf, readJson, tinyfishFetch } from "./client";

const SEARCH_API = "https://api.search.tinyfish.ai";

/** `ok: false` means the search could not be asked. That is never "nothing was found". */
export type Searched = { ok: true; results: unknown[] } | { ok: false; error: string };

/** Asks for pages about `query` on the site at `host`, between the two days when they are given. */
export async function searchSite(env: Env, query: string, host: string, dates: { after?: string; before?: string }): Promise<Searched> {
  const params = new URLSearchParams({ query, include_domains: host });
  if (dates.after) params.set("after_date", dates.after);
  if (dates.before) params.set("before_date", dates.before);
  try {
    const res = await tinyfishFetch(env, `${SEARCH_API}/?${params}`, { method: "GET" });
    const body = await readJson<{ results?: unknown }>(res);
    return Array.isArray(body.results) ? { ok: true, results: body.results } : { ok: false, error: "bad_answer" };
  } catch (err) {
    return { ok: false, error: codeOf(err) };
  }
}
