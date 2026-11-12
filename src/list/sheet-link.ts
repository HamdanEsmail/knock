// A Google Sheet, handed in by its link. Knock reads the sheet's own CSV export, which Google
// serves for a sheet that anyone with the link can view. Only a docs.google.com spreadsheet
// address is ever asked, so the link cannot be used to make Knock fetch anything else.
import { SHEET_CHARS_MAX } from "../core/limits";

export type SheetRead = { ok: true; csv: string } | { ok: false; status: number; code: string; message: string };

const refuse = (status: number, code: string, message: string): SheetRead => ({ ok: false, status, code, message });

const LINK = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:[/?#].*)?$/;

/** The address of a sheet's CSV export, from the link people copy out of the browser. Null for anything else. */
export function exportUrl(link: string): string | null {
  const m = LINK.exec(link.trim());
  if (m === null) return null;
  // The tab the visitor was on is named in the link; without it Google gives the first tab.
  const tab = /[?#&]gid=(\d{1,12})/.exec(link)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${tab === undefined ? "" : `&gid=${tab}`}`;
}

export async function readSheetLink(link: string): Promise<SheetRead> {
  const url = exportUrl(link);
  if (url === null) return refuse(400, "bad_sheet_link", "That is not the link of a Google Sheet. It begins with https://docs.google.com/spreadsheets/d/.");
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow" });
  } catch {
    return refuse(502, "sheet_not_read", "Google could not be reached to read the sheet. Send the link again in a moment.");
  }
  // A sheet that is not shared answers with a sign-in page, or with an error.
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/csv")) {
    return refuse(400, "sheet_not_shared", "The sheet could not be read. Share it so that anyone with the link can view it, then send the link again.");
  }
  if (Number(res.headers.get("content-length") ?? "0") > SHEET_CHARS_MAX * 4) return refuse(413, "sheet_too_large", "The sheet is too large for Knock to take.");
  return { ok: true, csv: await res.text() };
}
