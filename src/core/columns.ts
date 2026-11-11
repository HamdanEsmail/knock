// Which column of a sheet holds the company's name and which its address: from the header's
// words first, then from what the cells hold. A visitor can change both before the check starts.
import { cleanAddress, hostOf, siteOf } from "./address";

const ADDRESS_WORDS = /\b(website|web ?site|url|domain|homepage|home ?page|site|web|link)\b/i;
const NAME_WORDS_STRONG = /\b(company|startup|organi[sz]ation|business|account|vendor|firm|brand|customer|client)\b/i;
const NAME_WORDS = /\bname\b/i;
/** Headers and hosts that hold an address, but not the company's own. */
const NOT_ITS_OWN = /linkedin|twitter|facebook|instagram|crunchbase|youtube|angel|logo|image|photo|avatar|e-?mail/i;
const SOCIAL_SITES = new Set(["linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "crunchbase.com", "youtube.com", "angel.co", "wellfound.com"]);

const isNumber = (s: string): boolean => /^[\d\s.,%$€£-]+$/.test(s);

/** Whether the first line of a sheet is a header. It is not when it already holds a web address. */
export function hasHeader(first: string[]): boolean {
  return !first.some((cell) => cleanAddress(cell) !== null);
}

/** The columns Knock takes for the name and the address. `address` is null for a sheet of names only. */
export function guessColumns(header: string[], sample: string[][]): { name: number; address: number | null } {
  const width = Math.max(header.length, ...sample.map((r) => r.length), 1);
  const cells = (col: number): string[] => sample.map((r) => (r[col] ?? "").trim()).filter((c) => c !== "");

  const addressScore = (col: number): number => {
    const head = header[col] ?? "";
    if (NOT_ITS_OWN.test(head)) return 0;
    const filled = cells(col);
    const addresses = filled.map(cleanAddress).filter((a): a is string => a !== null);
    const social = addresses.filter((a) => SOCIAL_SITES.has(siteOf(hostOf(a)))).length;
    if (addresses.length > 0 && social * 2 > addresses.length) return 0;
    const share = filled.length === 0 ? 0 : addresses.length / filled.length;
    const named = ADDRESS_WORDS.test(head) ? 2 : 0;
    return named === 0 && share < 0.5 ? 0 : named + share;
  };

  let address: number | null = null;
  let best = 0;
  for (let col = 0; col < width; col++) {
    const score = addressScore(col);
    if (score > best) {
      best = score;
      address = col;
    }
  }

  const nameScore = (col: number): number => {
    if (col === address) return -1;
    const head = header[col] ?? "";
    if (ADDRESS_WORDS.test(head) || NOT_ITS_OWN.test(head)) return 0;
    const named = (NAME_WORDS_STRONG.test(head) ? 2 : 0) + (NAME_WORDS.test(head) ? 1 : 0);
    const filled = cells(col);
    const words = filled.filter((c) => !isNumber(c) && cleanAddress(c) === null && !c.includes("@")).length;
    const share = filled.length === 0 ? 0 : words / filled.length;
    // A column of words is worth a little; a header that says so is worth more.
    return named * 2 + (share >= 0.5 ? 1 : 0);
  };

  let name = 0;
  let bestName = -1;
  for (let col = 0; col < width; col++) {
    const score = nameScore(col);
    if (score > bestName) {
      bestName = score;
      name = col;
    }
  }
  return { name, address };
}
