// Sentences the pages show. A refusal from the form comes back as a code in the address, and
// the page shows the sentence for it: nothing a visitor typed is ever printed back.
import { COLUMNS_MAX, LISTS_PER_DAY, ROWS_MAX, SHEET_CHARS_MAX } from "../core/limits";
import { showDay } from "../core/dates";

const n = (v: number): string => v.toLocaleString("en-US");

export const NOTES: Record<string, string> = {
  empty_sheet: "The sheet is empty. Send a CSV with one company on each line.",
  header_only: "The sheet has a first line and no rows under it.",
  too_many_rows: `The sheet has more than ${n(ROWS_MAX)} rows. Knock takes at most ${n(ROWS_MAX)} in one list.`,
  sheet_too_large: `The sheet holds more than ${n(SHEET_CHARS_MAX)} characters. Knock takes at most ${n(ROWS_MAX)} rows in one list.`,
  too_many_columns: `The sheet has more than ${COLUMNS_MAX} columns. Knock takes at most ${COLUMNS_MAX}.`,
  bad_column: "The column chosen for the name or the address is not in the sheet.",
  daily_limit: `${LISTS_PER_DAY === 3 ? "Three" : LISTS_PER_DAY} lists have been handed in today, which is all Knock takes in a day. It opens again at midnight UTC.`,
  could_not_start: "The sheet was read, but its check could not be started. Nothing was kept: send it again in a moment.",
  started: "The check has been started again where it stopped.",
  "still working": "This list moved in the last ten minutes, so it is still being worked on. Nothing was started.",
  waiting: "This list is waiting and carries on by itself.",
  done: "This list is finished.",
};

/** What "Carry on" answers, in a sentence. */
export const CARRIED: Record<string, string> = {
  started: NOTES.started!,
  "still working": "The list moved in the last ten minutes, so it is still being worked on. Nothing was started.",
  waiting: NOTES.waiting!,
  done: NOTES.done!,
};

export const VERDICT_WORDS: Record<string, string> = { alive: "Alive", "slowing down": "Slowing down", zombie: "Zombie", "could not tell": "Could not tell" };

/** A moment as a page shows it: "13 Nov 2026, 00:00 UTC". */
export function showMoment(iso: string): string {
  return `${showDay(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC`;
}
