// Web addresses: turning what a cell holds into an address Knock can ask, and telling one
// site from another.

/** What people write in a cell when they have no address. */
const NOTHING = /^(n\/?a|none|null|nil|unknown|tbd|tba|-+|\?+|—+|–+)$/i;
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;
const NOT_WEB = /^(mailto|javascript|tel|data|file|ftp|sms):/i;
const EMAIL = /^[^\s/@]+@[^\s/@]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const TOP = /^([a-z]{2,}|xn--[a-z0-9-]+)$/;

/**
 * The address as Knock asks it: `https://host/path`. The scheme is kept when one was written;
 * without one it is https. Null when the cell holds no web address: empty, "n/a", an email,
 * a name, a number address, another kind of link.
 */
export function cleanAddress(raw: string): string | null {
  let s = raw.trim().replace(/^[<"'(\[]+|[>"')\]]+$/g, "").trim();
  if (s === "" || NOTHING.test(s) || /\s/.test(s) || NOT_WEB.test(s) || EMAIL.test(s)) return null;
  const scheme = SCHEME.exec(s)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") return null;
  if (scheme === undefined) s = `https://${s.replace(/^\/\//, "")}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  const labels = url.hostname.replace(/\.$/, "").split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TOP.test(labels.at(-1)!)) return null;
  url.hostname = labels.join(".");
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.href;
}

/** The host of an address, lower case and without a leading `www.`; empty when it is no address. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Endings under which the next label is a site of its own: country endings in two parts, and hosts shared by many sites. */
const TWO_PART = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp", "co.kr", "co.in", "co.za", "co.il",
  "com.br", "com.mx", "com.ar", "com.co", "com.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.tr", "com.ua", "com.pl", "com.ng", "com.eg", "com.sa", "com.pk",
  "github.io", "gitlab.io", "herokuapp.com", "netlify.app", "vercel.app", "pages.dev", "workers.dev", "webflow.io", "wordpress.com", "blogspot.com", "substack.com",
  "myshopify.com", "wixsite.com", "squarespace.com", "carrd.co", "notion.site", "tumblr.com", "firebaseapp.com", "web.app", "azurewebsites.net", "appspot.com",
  "glitch.me", "framer.website", "framer.app", "typeform.com", "strikingly.com", "weebly.com", "bubbleapps.io", "softr.app",
]);

/** The site a host belongs to: `blog.heroku.com` is on `heroku.com`. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  if (labels.length <= 2) return labels.join(".");
  const keep = TWO_PART.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

/** Whether two addresses are on the same site. */
export function sameSite(a: string, b: string): boolean {
  const x = siteOf(hostOf(a));
  return x !== "" && x === siteOf(hostOf(b));
}

/** Whether two addresses are the same page, whatever the last slash, a leading www or capitals in the host. */
export function sameUrl(a: string, b: string): boolean {
  const key = (s: string): string | null => {
    try {
      const u = new URL(s);
      return `${u.protocol}//${u.hostname.toLowerCase().replace(/^www\./, "")}${u.port ? `:${u.port}` : ""}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    } catch {
      return null;
    }
  };
  const x = key(a);
  return x !== null && x === key(b);
}

/** The same address under the other of http and https. */
export function otherScheme(url: string): string {
  return url.startsWith("https://") ? `http://${url.slice(8)}` : `https://${url.replace(/^http:\/\//, "")}`;
}
