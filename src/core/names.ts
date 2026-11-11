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

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Whether a text names the company: the words of the name in order, joined or apart, and not
 * inside a longer word. "Path" is not named by "pathway".
 */
export function namesCompany(text: string, name: string): boolean {
  const parts = words(name);
  if (parts.length === 0 || text === "") return false;
  const body = plain(text);
  if (UNSPACED.test(name)) return body.includes(parts.join(""));
  const pattern = `(?<![\\p{L}\\p{N}])${parts.map(escape).join("[^\\p{L}\\p{N}]*")}(?![\\p{L}\\p{N}])`;
  return new RegExp(pattern, "u").test(body);
}

/** Whether a host carries the company's name. Names of fewer than four characters say too little. */
export function hostNames(host: string, name: string): boolean {
  const key = nameKey(name);
  return key.length >= 4 && plain(host).replace(/[^\p{L}\p{N}]/gu, "").includes(key);
}
