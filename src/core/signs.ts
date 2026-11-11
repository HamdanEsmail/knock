// The shapes of everything Knock learns about a row. Each sign is kept as JSON on the row.

/** One page as TinyFish Fetch read it today, or the reason it could not be read. */
export type PageRead =
  | {
      url: string;
      ok: true;
      finalUrl: string;
      title: string | null;
      /** The day the page itself says it was published. */
      pageDate: string | null;
      /** The day the server gives for the page. */
      serverDate: string | null;
      /** The start of the page's text, and how long the whole text is. */
      text: string;
      chars: number;
      links: string[];
    }
  | { url: string; ok: false; error: string };

export type DoorKind = "answers" | "forwards" | "for_sale" | "nearly_empty" | "gone" | "error" | "blocked" | "timed_out" | "no_address" | "not_asked";

/** What happened at the company's address. */
export type DoorSign = {
  kind: DoorKind;
  /** The address that was asked, and where it led. */
  asked: string | null;
  finalUrl: string | null;
  /** For a forward: the host it leads to, and whether the page there names the company. */
  toHost: string | null;
  namesIt: boolean | null;
  title: string | null;
  chars: number;
  serverDate: string | null;
  jobsLink: string | null;
  signupLink: string | null;
  /** Fetch's own word for why the page could not be read. */
  error: string | null;
  /** How many times the door was knocked on. */
  knocks: number;
};

/** A dated page on the company's site, as Search listed it. */
export type Hit = { url: string; title: string; date: string };

export type Window = "12" | "36" | "any";

/** What Search knows of new pages on the company's own site. */
export type PagesSign = {
  /** The host that was asked about: the company's own, or the one its address now leads to. */
  host: string;
  /** False while a later window is still to be asked. */
  done: boolean;
  /** The windows asked so far, in order. */
  asked: Window[];
  /** The window in which dated pages were found, the newest of them and the next. */
  found: Window | null;
  newest: Hit | null;
  second: Hit | null;
  /** Dated pages on the site in that window. */
  count: number;
  /** Pages of the site the index lists without a date, in the last window asked. */
  undated: number;
  /** Set when Search could not be asked, after every try. Never set for "nothing found". */
  failed: string | null;
};

export type ReadKind = "hit" | "hit2" | "jobs" | "signup" | "source" | "activity";

/** One page Knock reads for a row beyond its home page, and what came of it. */
export type ReadItem = {
  kind: ReadKind;
  url: string;
  done: boolean;
  ok: boolean;
  finalUrl: string | null;
  title: string | null;
  pageDate: string | null;
  /** Whether the page names the company. Asked of pages that are not on its own site. */
  namesIt: boolean | null;
  error: string | null;
  tries: number;
};

/** What TinySet said about the company, each fact with its source. */
export type OutsideSign = {
  /** False when TinySet returned no row for this company. */
  returned: boolean;
  operates: boolean | null;
  outcome: string | null;
  outcomeDate: string | null;
  outcomeSource: string | null;
  activityDate: string | null;
  activityLink: string | null;
};

/** Everything known about one row when its verdict is decided. */
export type Signs = {
  name: string;
  address: string | null;
  door: DoorSign | null;
  pages: PagesSign | null;
  reads: ReadItem[];
  outside: OutsideSign | null;
};

export type Verdict = "alive" | "slowing down" | "zombie" | "could not tell";

export type DateFrom = "the page's own date" | "date from search" | "from TinySet's source" | "the server's date for the home page";

export type Decision = {
  verdict: Verdict;
  /** Which of the nine rules decided. */
  rule: number;
  lastSeen: string | null;
  lastSeenFrom: DateFrom | null;
  /** One plain sentence. */
  why: string;
  /** Links read today, the deciding one first. */
  evidence: string[];
};
