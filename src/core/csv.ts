// Reading and writing a sheet as CSV. Cells are kept exactly as they are written: the sheet
// that comes back must hold the visitor's own cells untouched.

const SEPARATORS = [",", ";", "\t"] as const;

/** The character between cells, found from the first line: the one that appears most outside quotes. */
function separatorOf(text: string): string {
  const counts = new Map<string, number>(SEPARATORS.map((s) => [s, 0]));
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && counts.has(ch)) counts.set(ch, counts.get(ch)! + 1);
  }
  let best: string = ",";
  for (const s of SEPARATORS) if (counts.get(s)! > counts.get(best)!) best = s;
  return best;
}

/**
 * The rows of a sheet. Handles quotes, doubled quotes, separators and line breaks inside a
 * quoted cell, CRLF line ends and a byte-order mark. A line whose cells are all empty is
 * dropped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = separatorOf(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  /** True once the current cell has been opened by a quote, so `""` is an empty cell and not nothing. */
  let wasQuoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"' && cell === "" && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
    } else if (ch === sep) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || wasQuoted || row.length > 0) endRow();
  return rows;
}

const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

/** A sheet as CSV text: commas, CRLF line ends, quotes only around the cells that need them. */
export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => (NEEDS_QUOTES.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",") + "\r\n").join("");
}
