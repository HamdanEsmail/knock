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
/** What a page costs beyond the free ones, and the most Knock may spend on them in all. */
export const READ_USD = 0.001;
export const READS_USD_MAX = 2;

/** TinyFish Search allows 30 a minute and 12,000 a day on the account. Knock keeps under both. */
export const SEARCHES_PER_MINUTE = 25;
export const SEARCHES_PER_DAY = 6000;

/** "Carry on" starts work only when the list has not moved for this long. */
export const STALLED_MS = 600_000;

/** Rows on one page of the board. */
export const BOARD_ROWS = 50;
