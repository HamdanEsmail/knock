// TinyFish Fetch: reads pages live, with their links, their own date and the server's date.
// One call carries up to five addresses, which matters on a plan that counts outside requests.
import { sameUrl } from "../core/address";
import { dayOf, httpDay } from "../core/dates";
import { LINKS_MAX, PAGE_CHARS, PAGE_TIMEOUT_MS, READS_PER_CALL } from "../core/limits";
import type { PageRead } from "../core/signs";
import type { Env } from "../env";
import { codeOf, readJson, tinyfishFetch } from "./client";

const FETCH_API = "https://api.fetch.tinyfish.ai";

/**
 * The error of an address that was asked and came back neither read nor refused. That says
 * nothing about the page, so the row it belongs to stays owed.
 */
export const NOT_ANSWERED = "not_answered";

/** `ok: false` means the call itself failed: nothing is known about any of its pages. */
export type PagesRead = { ok: true; pages: PageRead[] } | { ok: false; error: string };

type Result = { url?: unknown; final_url?: unknown; title?: unknown; published_date?: unknown; last_modified?: unknown; text?: unknown; links?: unknown };
type Failure = { url?: unknown; error?: unknown };

const sameAs = (url: string) => (entry: { url?: unknown }) => typeof entry.url === "string" && (entry.url === url || sameUrl(entry.url, url));

/** Reads the pages in one call. The answer has one entry for each address, in the order asked. */
export async function readPages(env: Env, urls: string[]): Promise<PagesRead> {
  if (urls.length > READS_PER_CALL) throw new RangeError(`readPages takes at most ${READS_PER_CALL} addresses`);
  if (urls.length === 0) return { ok: true, pages: [] };

  let body: { results?: Result[]; errors?: Failure[] };
  try {
    const res = await tinyfishFetch(env, FETCH_API, {
      method: "POST",
      body: JSON.stringify({ urls, format: "markdown", links: true, ttl: 0, include_etag_and_last_modified: true, per_url_timeout_ms: PAGE_TIMEOUT_MS }),
    });
    body = await readJson(res);
  } catch (err) {
    return { ok: false, error: codeOf(err) };
  }
  const results = Array.isArray(body.results) ? body.results : [];
  const errors = Array.isArray(body.errors) ? body.errors : [];

  const pages = urls.map((url): PageRead => {
    const failed = errors.find(sameAs(url));
    if (failed) return { url, ok: false, error: typeof failed.error === "string" && failed.error !== "" ? failed.error : "fetch_error" };
    const r = results.find(sameAs(url));
    if (!r) return { url, ok: false, error: NOT_ANSWERED };
    if (typeof r.text !== "string" || r.text.trim() === "") return { url, ok: false, error: "empty_content" };
    return {
      url,
      ok: true,
      finalUrl: typeof r.final_url === "string" && r.final_url !== "" ? r.final_url : url,
      title: typeof r.title === "string" && r.title !== "" ? r.title : null,
      pageDate: dayOf(r.published_date),
      serverDate: httpDay(r.last_modified),
      text: r.text.slice(0, PAGE_CHARS),
      chars: r.text.length,
      links: Array.isArray(r.links) ? r.links.filter((l): l is string => typeof l === "string").slice(0, LINKS_MAX) : [],
    };
  });
  return { ok: true, pages };
}
