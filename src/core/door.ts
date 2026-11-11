// The door: what a company's own address answered today, read from what TinyFish Fetch returned.
import { hostOf, sameSite, sameUrl, siteOf } from "./address";
import { THIN_CHARS } from "./limits";
import { hostNames, namesCompany } from "./names";
import type { DoorKind, DoorSign, PageRead } from "./signs";

/** Words a page uses when the address itself is on offer. */
const FOR_SALE = /(domain|website|site|name)[^.\n]{0,60}(is|are|may be)?\s*(for sale|available for purchase)|premium domain for sale|buy this domain|this domain (is|may be) (for sale|available)|make an offer on this domain|domain name is for sale|inquire about this domain/i;
/** Sites that sell addresses. A door that leads to one of them is for sale. */
const SELLERS = new Set(["atom.com", "hugedomains.com", "sedo.com", "afternic.com", "dan.com", "bodis.com", "undeveloped.com", "domainmarket.com", "buydomains.com", "squadhelp.com", "brandbucket.com", "parkingcrew.net", "sedoparking.com", "domainnamesales.com", "uniregistry.com", "efty.com", "godaddy.com"]);
/** What a registrar or a web server shows where no site has been put. */
const PLACEHOLDER = /recently registered with|domain (is )?parked|parked (free|domain)|domain parking|coming soon|under construction|default web page|welcome to nginx|apache2? .{0,20}default page|it works!|account (has been )?suspended|site not found|no such app|there isn't a github pages site here|website is no longer available/i;

const FAILURES: Record<string, DoorKind> = {
  invalid_url: "gone",
  timeout: "timed_out",
  bot_blocked: "blocked",
  login_required: "blocked",
  empty_content: "nearly_empty",
};

/**
 * What the door said. `address` is the company's address as the sheet gave it, `read` what
 * came back for it, `knocks` how many times it has now been asked.
 */
export function readDoor(read: PageRead, name: string, address: string, knocks = 1): DoorSign {
  const sign: DoorSign = { kind: "answers", asked: address, finalUrl: null, toHost: null, namesIt: null, title: null, chars: 0, serverDate: null, jobsLink: null, signupLink: null, error: null, knocks };
  if (!read.ok) return { ...sign, kind: FAILURES[read.error] ?? "error", error: read.error };

  sign.finalUrl = read.finalUrl;
  sign.title = read.title;
  sign.chars = read.chars;
  sign.serverDate = read.serverDate;
  const moved = !sameSite(read.finalUrl, address);
  const toHost = hostOf(read.finalUrl);
  if (moved) sign.toHost = toHost;
  const start = `${read.title ?? ""}\n${read.text.slice(0, 1500)}`;

  if (SELLERS.has(siteOf(toHost)) ? moved : FOR_SALE.test(start)) return { ...sign, kind: "for_sale" };
  if (read.chars < THIN_CHARS || (read.chars < 1500 && PLACEHOLDER.test(start))) return { ...sign, kind: "nearly_empty" };
  if (moved) {
    sign.kind = "forwards";
    sign.namesIt = namesCompany(`${read.title ?? ""}\n${read.text}`, name) || hostNames(toHost, name);
    if (!sign.namesIt) return sign;
  }
  const site = siteOf(toHost);
  sign.jobsLink = findLink(read.links, "jobs", site, read.finalUrl);
  sign.signupLink = findLink(read.links, "signup", site, read.finalUrl);
  return sign;
}

const JOBS_PATH = /\/(careers?|jobs|join-us|join|work-with-us|open-positions|vacancies|hiring)\/?$/i;
const JOBS_HOSTS = /^(jobs|careers?)\./i;
const JOB_BOARDS = new Set(["greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "breezy.hr", "bamboohr.com", "recruitee.com", "smartrecruiters.com", "teamtailor.com", "personio.de", "personio.com", "rippling.com", "gusto.com"]);
/** Sign-up first, then prices, then logging in: each says a little less that new customers are taken. */
const SIGNUP_PATHS = [/\/(sign[-_]?up|register|get[-_]started|start[-_]free|free[-_]trial|trial|join)\/?$/i, /\/(pricing|plans|request[-_]?(a[-_])?demo|demo|demorequest|book[-_]?(a[-_])?demo|contact[-_]sales)\/?$/i, /\/(log[-_]?in|sign[-_]?in)\/?$/i];
const APP_HOSTS = /^(app|dashboard|login|my|portal|account|accounts)\./i;

/**
 * A link from the home page to the company's jobs page or to where a customer signs up.
 * Only pages on the company's own site count, and for jobs the boards companies hire through.
 */
export function findLink(links: string[], kind: "jobs" | "signup", site: string, home?: string): string | null {
  const pages = links.flatMap((link) => {
    try {
      const u = new URL(link);
      return u.protocol === "http:" || u.protocol === "https:" ? [{ link, host: u.hostname.toLowerCase().replace(/^www\./, ""), path: u.pathname }] : [];
    } catch {
      return [];
    }
  });
  const own = pages.filter((p) => siteOf(p.host) === site && !(home !== undefined && sameUrl(p.link, home)));
  const shortest = (found: { link: string }[]): string | null => (found.length === 0 ? null : found.reduce((a, b) => (b.link.length < a.link.length ? b : a)).link);

  if (kind === "jobs") {
    return shortest(own.filter((p) => JOBS_PATH.test(p.path) || JOBS_HOSTS.test(p.host))) ?? shortest(pages.filter((p) => JOB_BOARDS.has(siteOf(p.host))));
  }
  for (const pattern of SIGNUP_PATHS) {
    const found = shortest(own.filter((p) => pattern.test(p.path)));
    if (found !== null) return found;
  }
  return shortest(own.filter((p) => APP_HOSTS.test(p.host)));
}
