// Days. Knock keeps every date as a day, YYYY-MM-DD, and says where each one comes from.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;

const pad = (n: number): string => String(n).padStart(2, "0");

/** A real day of the calendar as YYYY-MM-DD, or null. */
function day(y: number, m: number, d: number): string | null {
  if (!(y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

const monthOf = (word: string): number => MONTHS.indexOf(word.toLowerCase().slice(0, 3)) + 1;

/** The day `days` before `today`. */
function daysBefore(today: string, days: number): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
}

/** The day `months` before `today`; the 31st becomes the month's last day where there is no 31st. */
export function monthsBefore(today: string, months: number): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return `${first.getUTCFullYear()}-${pad(first.getUTCMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/**
 * The day a search result is dated. Search writes "May 7, 2026", sometimes "7 days ago".
 * Anything in another shape, and any day that has not come yet, is no date at all: a date
 * is never guessed.
 */
export function searchDay(v: unknown, today: string): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  let found: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = ISO.exec(s))) found = day(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(s))) found = day(Number(m[3]), monthOf(m[1]!), Number(m[2]));
  else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(s))) found = day(Number(m[3]), monthOf(m[2]!), Number(m[1]));
  else if ((m = /^(\d{1,3})\s+(minute|hour|day|week|month|year)s?\s+ago$/i.exec(s))) {
    const n = Number(m[1]);
    const unit = m[2]!.toLowerCase();
    found = unit === "minute" || unit === "hour" ? today : unit === "day" ? daysBefore(today, n) : unit === "week" ? daysBefore(today, n * 7) : monthsBefore(today, unit === "month" ? n : n * 12);
  }
  return found !== null && found <= today ? found : null;
}

/** Whole months from `day` to `today`: 0 for this month's days, 12 for the same day a year ago. */
export function monthsAgo(day: string, today: string): number {
  const [y1, m1, d1] = day.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split("-").map(Number) as [number, number, number];
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

/** The day in a date a server sends with a page, such as "Wed, 11 Nov 2026 17:25:52 GMT". */
export function httpDay(v: unknown): string | null {
  if (typeof v !== "string" || !/^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} /.test(v)) return null;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : new Date(at).toISOString().slice(0, 10);
}

/** The day a page says it was published, when it says so in a form that starts with a full date. */
export function dayOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = ISO.exec(v);
  return m ? day(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** A day in words: "5 Nov 2026". */
export function showDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${d} ${SHORT[m - 1]} ${y}`;
}

/** Today as a day, in UTC. */
export function dayNow(now: Date): string {
  return now.toISOString().slice(0, 10);
}
