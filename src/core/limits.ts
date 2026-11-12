// Every number that bounds what Knock does, in one place.

/** A sheet may hold this many rows, columns and characters. */
export const ROWS_MAX = 1000;
export const COLUMNS_MAX = 60;
export const SHEET_CHARS_MAX = 600_000;
/** A cell longer than this is cut when it is taken as a name. The visitor's own cell is kept whole. */
export const NAME_CHARS_MAX = 120;

/** New lists all visitors together may hand in on one day. */
export const LISTS_PER_DAY = 3;
/** "Knock on one door" on the first page: tries a visitor has in an hour, and all visitors in a day. */
export const KNOCKS_PER_VISITOR_PER_HOUR = 10;
export const KNOCKS_PER_DAY = 300;

// ---- The verdict's thresholds (design, section 5) ----

/** A dated sign newer than this many months means alive. */
export const ALIVE_MONTHS = 12;
/** A newest dated sign older than this many months means zombie. */
export const ZOMBIE_MONTHS = 36;
/** A home page with less text than this is nearly empty. */
export const THIN_CHARS = 400;

// ---- How a list is worked ----

/** A list is worked this many rows at a time, each group through every stage before the next. */
export const GROUP_ROWS = 40;
/** TinyFish Fetch reads this many addresses in one call. */
export const READS_PER_CALL = 5;
/** Fetch calls a leg sends at the same moment. */
export const CALLS_AT_ONCE = 4;
/**
 * Cloudflare's free plan allows one Workflow run 50 requests to other hosts. A leg makes at
 * most this many calls; a step is tried at most twice, so a leg stays under 40.
 */
export const CALLS_PER_LEG = 18;
/** How often a step is tried in all. */
export const STEP_TRIES = 2;
/**
 * The free plan also allows one run 50 database queries. A leg counts what its turns may cost
 * at most and hands over before it would pass this, which leaves room for a step tried twice.
 */
export const QUERIES_PER_LEG = 40;
/** A page is given this long to answer. */
export const PAGE_TIMEOUT_MS = 30_000;
/** A call that failed as a whole is tried this many times in all before the row says "could not be asked". */
export const TRIES = 3;
/** A door that failed is knocked on twice in all. */
export const DOOR_KNOCKS = 2;

/**
 * Pages Knock may read in a day without paying. TinyFish Fetch is free up to 1,000 pages a
 * day on the account, and I use the same account for other things, so Knock keeps to 800.
 */
export const FREE_READS_PER_DAY = 800;
/**
 * What a page costs beyond the free ones, and the most Knock may spend on them in all. Six
 * dollars is 6,000 pages: room for several long sheets from visitors, also on the same day.
 * It was two dollars until the 590 had used 866 of those 2,000 pages in one day.
 */
export const READ_USD = 0.001;
export const READS_USD_MAX = 6;

/**
 * TinyFish Search is free up to 30 requests a minute and 12,000 a day on the account, and its
 * price list also gives the allowance as 500 an hour. Seven a minute, across all lists, stays
 * under all three with one counter, and Knock keeps to half the day's allowance.
 */
export const SEARCHES_PER_MINUTE = 7;
export const SEARCHES_PER_DAY = 6000;

// ---- TinySet ----

/** Rows in one set. */
export const SET_ROWS = 50;
/** What TinySet charges for a row that comes back. */
export const SET_ROW_USD = 0.1;
/** A fill is looked at once a minute: this many times in one leg, and it is stopped after this many looks in all. */
export const LOOK_EVERY_MS = 60_000;
export const LOOKS_PER_LEG = 12;
export const LOOKS_MAX = 40;
/** A dataset that is still empty after this many looks was never filled. */
export const EMPTY_LOOKS = 3;
/** The wallet is read this long after a set's last fill ended, because a charge can reach it late. */
export const CHARGE_LANDS_MS = 600_000;

/** "Carry on" starts work only when the list has not moved for this long. */
export const STALLED_MS = 600_000;

/** Rows on one page of the board. */
export const BOARD_ROWS = 50;

/** How much of a page's text and how many of its links are looked at. */
export const PAGE_CHARS = 20_000;
export const LINKS_MAX = 300;
