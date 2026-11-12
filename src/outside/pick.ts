// Which rows of a finished list go to TinySet, and in what order (design, section 6): the
// rows where an outside source can add the most come first.
import { nameKey } from "../core/names";

/** What is needed of a row to choose it. `door` is the kind of its door sign. */
export type Candidate = { n: number; name: string; door: string | null; namesIt: boolean | null; verdict: string | null; rule: number | null; setId: string | null };

/**
 * 0 forwards elsewhere (only an outside source can tell a new name from a takeover),
 * 1 no address, 2 the address no longer exists, 3 an error, a block or no answer in time,
 * 4 nearly empty, 5 the site loads and shows nothing new. Null: nothing for TinySet to add.
 */
function order(c: Candidate): number | null {
  const kind = c.door ?? "not_asked";
  if (kind === "forwards") return 0;
  if (kind === "no_address") return 1;
  if (kind === "gone") return 2;
  if (kind === "error" || kind === "blocked" || kind === "timed_out" || kind === "not_asked") return 3;
  if (kind === "nearly_empty") return 4;
  if (kind === "answers" && c.verdict !== "alive") return 5;
  return null;
}

/**
 * At most `count` rows for one set. A row belongs to one set only, and two rows with the same
 * name never share a set, because the name is the set's key. With `named`, exactly those rows
 * are taken, in that order, as far as they may be.
 */
export function pickRows(rows: Candidate[], count: number, named?: number[]): number[] {
  const byNumber = new Map(rows.map((r) => [r.n, r]));
  const wanted =
    named !== undefined
      ? named.flatMap((n) => byNumber.get(n) ?? [])
      : rows
          .flatMap((r) => {
            const o = order(r);
            return o === null ? [] : [{ r, o }];
          })
          .sort((a, b) => a.o - b.o || a.r.n - b.r.n)
          .map((x) => x.r);
  const taken: number[] = [];
  const names = new Set<string>();
  for (const r of wanted) {
    if (taken.length >= count) break;
    const key = nameKey(r.name);
    if (r.setId !== null || key === "" || names.has(key) || taken.includes(r.n)) continue;
    names.add(key);
    taken.push(r.n);
  }
  return taken;
}
