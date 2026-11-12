// Lays the rows TinySet returned over the rows that were sent. A row whose name is not on
// the list, or whose website is another site than the one sent, is thrown away: TinySet
// finds its own rows, so nothing it returns is taken on trust.
import { cleanAddress, hostOf, siteOf } from "../core/address";
import { dayOf } from "../core/dates";
import { nameKey } from "../core/names";
import type { OutsideSign } from "../core/signs";
import type { SetRow } from "./spec";

export type Matched = {
  /** What TinySet said, by the row's number in the list. */
  matched: Map<number, OutsideSign>;
  /** Names that came back and are not on the list. */
  offList: string[];
  /** Listed names that came back on another site than the one sent. */
  wrongSite: string[];
  /** Rows that were sent and did not come back. */
  missing: number[];
};

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

const yesNo = (v: unknown): boolean | null => {
  if (typeof v === "boolean") return v;
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return s === "true" || s === "yes" ? true : s === "false" || s === "no" ? false : null;
};

/** A link that can be read: http or https, written in full. */
const link = (v: unknown): string | null => {
  const s = text(v);
  return s !== null && /^https?:\/\//i.test(s) && hostOf(s).includes(".") ? s : null;
};

const siteIn = (v: unknown): string => {
  const s = text(v);
  const address = s === null ? null : cleanAddress(s);
  return address === null ? "" : siteOf(hostOf(address));
};

/** What a row that never came back is given, so the row says "TinySet returned nothing". */
export const NOTHING_RETURNED: OutsideSign = { returned: false, operates: null, outcome: null, outcomeDate: null, outcomeSource: null, activityDate: null, activityLink: null };

export function matchRows(sent: SetRow[], returned: Record<string, unknown>[]): Matched {
  const byName = new Map(sent.map((r) => [nameKey(r.name), r]));
  const matched = new Map<number, OutsideSign>();
  const offList: string[] = [];
  const wrongSite: string[] = [];
  for (const data of returned) {
    const name = text(data.company_name);
    if (name === null) continue;
    const row = byName.get(nameKey(name));
    if (row === undefined) {
      offList.push(name);
      continue;
    }
    if (matched.has(row.n)) continue;
    const wanted = row.address === null ? "" : siteOf(hostOf(row.address));
    const got = siteIn(data.website);
    if (wanted !== "" && got !== wanted) {
      wrongSite.push(`${name} (${got || "no site"}, sent ${wanted})`);
      continue;
    }
    matched.set(row.n, {
      returned: true,
      operates: yesNo(data.still_operates),
      outcome: text(data.outcome),
      outcomeDate: dayOf(data.outcome_date),
      outcomeSource: link(data.outcome_source),
      activityDate: dayOf(data.most_recent_activity_date),
      activityLink: link(data.most_recent_activity_link),
    });
  }
  return { matched, offList, wrongSite, missing: sent.filter((r) => !matched.has(r.n)).map((r) => r.n) };
}
