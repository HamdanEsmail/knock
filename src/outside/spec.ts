// What a set asks TinySet for. TinySet finds its own rows; there is no way to hand it mine.
// What made it keep to a list, in the test I paid for, was the list written into the
// dataset's description, with the company's name as the key.
import { hostOf } from "../core/address";

/** One row of a list as it is sent to TinySet. */
export type SetRow = { n: number; name: string; address: string | null };

export type Column = { name: string; label: string; type: "string" | "boolean" | "date" | "url"; is_primary_key: boolean; retrieval_hint: string; format: string; examples: string[] };
export type Spec = { name: string; description: string; columns: Column[] };

/** TinySet keeps a hint of at most this many characters. The description is kept whole. */
const HINT_MAX = 2000;

const oneLine = (s: string): string => s.replace(/\s+/g, " ").trim();

export function specFor(rows: SetRow[]): Spec {
  const names = rows.map((r) => oneLine(r.name));
  const site = (r: SetRow): string => (r.address === null ? "" : hostOf(r.address));
  const entry = (r: SetRow, i: number): string => `${names[i]} (${site(r) || "no website known"})`;
  const meant = "The company meant is the one that owns or owned the website paired with the name in the dataset description.";
  const named = `One of exactly these ${rows.length} names, written as here: ${names.join(", ")}. ${meant}`;
  const key = named.length <= HINT_MAX ? named : `One of exactly the ${rows.length} names in the list in the dataset description, written as there. ${meant}`;
  return {
    name: `Signs of life for ${rows.length} listed companies`,
    description: `One row for each company on this list and no other company. The list, as name (website): ${rows.map(entry).join("; ")}. Each row gives one listed company's signs of life: whether it still operates today, what happened to it if it does not operate on its own, with the date and a link that proves it, and its most recent public activity with a link. A company that is not on the list is never a row.`,
    columns: [
      { name: "company_name", label: "Company name", type: "string", is_primary_key: true, retrieval_hint: key, format: "The name as written in the list, no legal suffix", examples: names.slice(0, 3) },
      {
        name: "website",
        label: "Website",
        type: "string",
        is_primary_key: false,
        retrieval_hint: "Taken as written from the list in the dataset description, beside the company's name; empty when the list says no website is known.",
        format: "Domain only as given in the list, no scheme or path",
        examples: rows.map(site).filter((s) => s !== "").slice(0, 3),
      },
      {
        name: "still_operates",
        label: "Still operates",
        type: "boolean",
        is_primary_key: false,
        retrieval_hint: "Whether the company still runs as an operating business today; false if it was shut down, or absorbed and closed after an acquisition.",
        format: "true or false",
        examples: ["true", "false"],
      },
      {
        name: "outcome",
        label: "Outcome",
        type: "string",
        is_primary_key: false,
        retrieval_hint: "From news coverage or the company's own announcement of its acquisition, merger, renaming or shutdown.",
        format: "One of: acquired, merged, renamed, shut down, plus the acquirer or new name, e.g. 'acquired by X'; empty when still operating on its own",
        examples: ["acquired by Microsoft", "shut down", "renamed to DoorDash"],
      },
      {
        name: "outcome_date",
        label: "Outcome date",
        type: "date",
        is_primary_key: false,
        retrieval_hint: "The publicly announced date of the acquisition, merger, renaming or shutdown, from news or the announcement itself.",
        format: "YYYY-MM-DD; empty when still operating on its own",
        examples: ["2016-09-12", "2020-12-01"],
      },
      {
        name: "outcome_source",
        label: "Outcome source",
        type: "url",
        is_primary_key: false,
        // A directory's page about the company would be a second-hand record. Y Combinator's is also what I score Knock against.
        retrieval_hint:
          "A news article, or the company's or its buyer's own announcement, documenting the outcome event. Not a directory or profile page about the company, such as Y Combinator's company directory, Crunchbase or LinkedIn.",
        format: "Full URL including https://; empty when still operating on its own",
        examples: ["https://techcrunch.com/2016/09/12/parse-goes-away/"],
      },
      {
        name: "most_recent_activity_date",
        label: "Most recent activity date",
        type: "date",
        is_primary_key: false,
        retrieval_hint: "The date of the company's latest public activity: newest blog post, product release, news item or social post.",
        format: "YYYY-MM-DD",
        examples: ["2026-10-20", "2017-04-17"],
      },
      {
        name: "most_recent_activity_link",
        label: "Most recent activity link",
        type: "url",
        is_primary_key: false,
        retrieval_hint: "A link to that most recent public activity: the blog post, release note, news article or social post itself. Not a directory or profile page about the company.",
        format: "Full URL including https://",
        examples: ["https://stripe.com/blog/..."],
      },
    ],
  };
}
