// Taking a sheet in: reading it, finding the two columns, and writing the list and its rows.
// A sheet that cannot be taken is refused with a sentence that says why, and leaves nothing behind.
import { cleanAddress, hostOf } from "../core/address";
import { guessColumns, hasHeader } from "../core/columns";
import { parseCsv } from "../core/csv";
import { dayNow } from "../core/dates";
import { COLUMNS_MAX, LISTS_PER_DAY, NAME_CHARS_MAX, ROWS_MAX, SHEET_CHARS_MAX } from "../core/limits";
import type { Env } from "../env";
import { deleteList, giveBack, insertList, takeSlot, type NewRow } from "./store";

export type Refused = { ok: false; status: 400 | 413 | 429 | 503; code: string; message: string };

const refuse = (status: Refused["status"], code: string, message: string): Refused => ({ ok: false, status, code, message });
const count = (n: number): string => n.toLocaleString("en-US");

/** A sheet as Knock understands it. */
export type Sheet = {
  /** The first line of the sheet that goes back: the sheet's own, or `column_1` and so on when it had none. */
  header: string[];
  hadHeader: boolean;
  /** The lines that are companies, each as the visitor's own cells. */
  rows: string[][];
  nameCol: number;
  addressCol: number | null;
};

/** Words a first line uses when it is a header and not a company. */
const HEADER_WORDS = /\b(company|companies|name|startup|organi[sz]ation|business|brand|vendor|account|customer|client|website|web ?site|url|domain|site|homepage|link|description|status|batch|year|founded|country|city|location|industry|sector|category|notes?|id)\b/i;

const isColumn = (v: unknown, width: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < width;

/**
 * Reads a sheet and finds the name and address columns. `nameCol`, `addressCol` and
 * `firstLineIsHeader` are the caller's own choices, when it made any.
 */
export function readSheet(csv: unknown, chosen: { nameCol?: unknown; addressCol?: unknown; firstLineIsHeader?: unknown } = {}): { ok: true; sheet: Sheet } | Refused {
  const empty = () => refuse(400, "empty_sheet", "The sheet is empty. Send a CSV with one company on each line.");
  if (typeof csv !== "string") return empty();
  if (csv.length > SHEET_CHARS_MAX) return refuse(413, "sheet_too_large", `The sheet holds more than ${count(SHEET_CHARS_MAX)} characters. Knock takes at most ${count(ROWS_MAX)} rows in one list.`);
  const lines = parseCsv(csv);
  const first = lines[0];
  if (first === undefined) return empty();

  const width = lines.reduce((w, line) => Math.max(w, line.length), 0);
  if (width > COLUMNS_MAX) return refuse(400, "too_many_columns", `The sheet has ${count(width)} columns. Knock takes at most ${COLUMNS_MAX}.`);

  // The first line is a header when it holds no address and either reads like one, or the
  // lines under it hold addresses. A sheet of names only keeps a first line that is a company.
  const hadHeader =
    typeof chosen.firstLineIsHeader === "boolean"
      ? chosen.firstLineIsHeader
      : hasHeader(first) && (first.some((cell) => HEADER_WORDS.test(cell)) || lines.slice(1, 51).some((line) => line.some((cell) => cleanAddress(cell) !== null)));
  const rows = hadHeader ? lines.slice(1) : lines;
  if (rows.length === 0) return refuse(400, "header_only", "The sheet has a first line and no rows under it.");
  if (rows.length > ROWS_MAX) return refuse(400, "too_many_rows", `The sheet has ${count(rows.length)} rows. Knock takes at most ${count(ROWS_MAX)} in one list.`);

  const header = Array.from({ length: width }, (_, i) => (hadHeader && (first[i] ?? "").trim() !== "" ? first[i]! : `column_${i + 1}`));
  const guess = guessColumns(hadHeader ? first : [], rows.slice(0, 50));
  if (chosen.nameCol !== undefined && chosen.nameCol !== null && !isColumn(chosen.nameCol, width)) return refuse(400, "bad_column", "The column chosen for the name is not in the sheet.");
  if (chosen.addressCol !== undefined && chosen.addressCol !== null && !isColumn(chosen.addressCol, width)) return refuse(400, "bad_column", "The column chosen for the address is not in the sheet.");
  const nameCol = isColumn(chosen.nameCol, width) ? chosen.nameCol : guess.name;
  // An address column given as null means the caller says there is none.
  const addressCol = isColumn(chosen.addressCol, width) ? chosen.addressCol : chosen.addressCol === null ? null : guess.address;
  return { ok: true, sheet: { header, hadHeader, rows, nameCol, addressCol } };
}

/** The rows of a sheet as they are first written: the name, the address as Knock asks it, and the visitor's own cells. */
export function sheetRows(sheet: Sheet): NewRow[] {
  return sheet.rows.map((cells, n) => {
    const address = sheet.addressCol === null ? null : cleanAddress(cells[sheet.addressCol] ?? "");
    const name = (cells[sheet.nameCol] ?? "").trim().slice(0, NAME_CHARS_MAX);
    return { n, cells, name: name !== "" ? name : address !== null ? hostOf(address) : "", address };
  });
}

const ID_LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => ID_LETTERS[b % ID_LETTERS.length]).join("");
}

export type NewList = { title?: unknown; source?: unknown; csv?: unknown; nameCol?: unknown; addressCol?: unknown; firstLineIsHeader?: unknown };
export type Made = { ok: true; id: string; rows: number } | Refused;

/**
 * Takes a list in and starts its check. `owner` is "mine" for a list I hand in with the admin
 * token; a visitor's list uses one of the day's few. `start` begins the work on the new list.
 */
export async function createList(env: Env, input: NewList, owner: "visitor" | "mine", now: Date, start: (id: string) => Promise<void>): Promise<Made> {
  const read = readSheet(input.csv, input);
  if (!read.ok) return read;
  const rows = sheetRows(read.sheet);

  // Only a sheet that passed every check uses one of the day's lists.
  const day = dayNow(now);
  if (owner === "visitor" && !(await takeSlot(env.DB, day, "lists", LISTS_PER_DAY))) {
    return refuse(429, "daily_limit", `${LISTS_PER_DAY === 3 ? "Three" : LISTS_PER_DAY} lists have been handed in today, which is all Knock takes in a day. It opens again at midnight UTC.`);
  }

  const id = newId();
  const given = typeof input.title === "string" ? input.title.trim().replace(/\s+/g, " ").slice(0, 120).trim() : "";
  const title = given !== "" ? given : `A list of ${count(rows.length)} ${rows.length === 1 ? "company" : "companies"}`;
  try {
    await insertList(env.DB, { id, title, source: input.source === "sheet" ? "sheet" : "csv", owner, header: read.sheet.header, nameCol: read.sheet.nameCol, addressCol: read.sheet.addressCol, now: now.toISOString() }, rows);
    await start(id);
  } catch {
    // A list whose check never began is not kept, and does not count against the day.
    await deleteList(env.DB, id).catch(() => undefined);
    if (owner === "visitor") await giveBack(env.DB, day, "lists").catch(() => undefined);
    return refuse(503, "could_not_start", "The sheet was read, but its check could not be started. Nothing was kept: send it again in a moment.");
  }
  return { ok: true, id, rows: rows.length };
}
