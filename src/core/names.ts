// Company names: a key to compare them by, and whether a page names a company.

/** Words at the end of a name that say what kind of company it is, and nothing about which. */
const LEGAL = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "gmbh", "ag", "sa", "sas", "bv", "plc", "pty", "pte", "srl", "oy", "ab", "as"]);
/** Scripts written without spaces between words, where "a whole word" has no meaning. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u;

/** Lower case, with accents taken off their letters. */
const plain = (s: string): string => s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();

/** The words of a name, without the legal ending. */
function words(name: string): string[] {
  const all = plain(name).split(/[^\p{L}\p{N}]+/u).filter((w) => w !== "");
  while (all.length > 1 && LEGAL.has(all.at(-1)!)) all.pop();
  return all;
}

/** A name's letters and digits, in lower case and without accents or a legal ending: "Yik Yak" is `yikyak`. */
export function nameKey(name: string): string {
  return words(name).join("");
}

/** A part in brackets, round or square, in either width. */
const BRACKETED = /[(（[]([^()（）[\]]*)[)）\]]/gu;
/** Words that lead another name in: "formerly Instabug", "aka Threshold Network". */
const LEAD = /^(?:formerly|previously|now|also|known\s+as|aka|a\.k\.a\.?|fka|f\/k\/a|dba|d\/b\/a)[\s:,]+/iu;
/** A name of fewer characters than this says too little on its own, inside a host or as a second name. */
const TELLING = 4;

/**
 * The two names a sheet often writes in one cell: "Kenota (formerly ExVivo Labs)" is Kenota,
 * and was ExVivo Labs. `main` is the name outside the brackets, `alias` the first name inside
 * them without the word that leads it in. A name without brackets, or with nothing outside
 * them, is its own `main`.
 */
export function nameParts(name: string): { main: string; alias: string | null } {
  const whole = name.trim();
  const inside = [...whole.matchAll(BRACKETED)].map((m) => (m[1] ?? "").trim()).filter((s) => s !== "");
  const outside = whole.replace(BRACKETED, " ").replace(/\s+/g, " ").trim();
  if (inside.length === 0 || words(outside).length === 0) return { main: whole, alias: null };
  let alias = inside[0]!;
  while (LEAD.test(alias)) alias = alias.replace(LEAD, "").trim();
  return { main: outside, alias: alias === "" ? null : alias };
}

/** The names a company may go by on a page: the whole cell, the name outside the brackets, and a second name that says enough. */
function forms(name: string): string[] {
  const { main, alias } = nameParts(name);
  const all = [name];
  if (alias !== null) {
    all.push(main);
    if (nameKey(alias).length >= TELLING) all.push(alias);
  }
  return all;
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function namesOne(body: string, name: string): boolean {
  const parts = words(name);
  if (parts.length === 0) return false;
  if (UNSPACED.test(name)) return body.includes(parts.join(""));
  const pattern = `(?<![\\p{L}\\p{N}])${parts.map(escape).join("[^\\p{L}\\p{N}]*")}(?![\\p{L}\\p{N}])`;
  return new RegExp(pattern, "u").test(body);
}

/**
 * Whether a text names the company: the words of the name in order, joined or apart, and not
 * inside a longer word. "Path" is not named by "pathway". A name with a part in brackets is
 * named by either part.
 */
export function namesCompany(text: string, name: string): boolean {
  if (text === "") return false;
  const body = plain(text);
  return forms(name).some((form) => namesOne(body, form));
}

/** Whether a host carries the company's name, or either part of it. Names of fewer than four characters say too little. */
export function hostNames(host: string, name: string): boolean {
  const letters = plain(host).replace(/[^\p{L}\p{N}]/gu, "");
  return forms(name).some((form) => {
    const key = nameKey(form);
    return key.length >= TELLING && letters.includes(key);
  });
}
