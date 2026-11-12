# Knock: build plan

12 November 2026. The design is `docs/specs/2026-11-11-knock-design.md`; this is the order I build it in and the decisions the design left to the build.

**Goal.** A spreadsheet of 500 or more companies goes in; the same sheet comes back with a verdict, the date the company was last seen and links to the evidence on every row.

**How it is built.** One Cloudflare Worker on the free plan: Hono for pages and API, D1 for lists and rows, one Workflow that works a list in short legs. Every sign is read from a live page by TinyFish Fetch or TinyFish Search; TinySet adds what a company's own site cannot say. The verdict is a pure function of the signs.

**Stack.** TypeScript (ESM, strict), Hono 4.13.16 with hono/jsx, Wrangler 4.157.0, Vitest 5.1.0 with the Cloudflare pool. The same versions as Upstream, and no other dependency.

## Rules for the whole build

- Tests never reach the network: every outside call in a test is answered by a stand-in that throws on anything it was not told about.
- A test is written and seen failing before the code that makes it pass.
- A leg makes at most 40 requests to other hosts, counted with every step tried twice.
- The free plan allows 50 database queries in one run. Many rows are therefore written by one statement (`json_each`), never one statement a row.
- A failed call is not a sign. A search that was refused never becomes "nothing new"; a Fetch call that failed as a whole never becomes a result for its rows.
- Nothing paid happens while `SPEND_CAP_USD` is 0, and it is 0 in `wrangler.jsonc`.
- The TinyFish key lives in `.dev.vars` and in the Worker's secrets, and is never printed or logged.
- Every page carries "Built by Hamdan Esmail", linked to my GitHub. A page that waits shows that it is working.
- All numbers that bound what Knock does sit in `src/core/limits.ts`.

## What I checked before planning (11 November, all free)

- **"The address no longer exists" is real.** Fetch answers `invalid_url` for 14 of the 100 probe addresses. I asked DNS about each: none of the 14 resolves. Every other kind of failure (error, time-out, blocked, empty) resolves. So `invalid_url` on a well-formed address means the name is gone.
- **TinySet keeps a list of 50 as written.** I made an empty dataset with 50 names in its description (40 with an address, 10 marked "no website known"). The stored description is the one I sent, character for character, and the wallet did not move. Whether it opens one search per name at this size is what the gate set shows.
- **Cloudflare's limits (docs read 11 November).** One run: 50 requests to other hosts, 50 database queries, 10 ms of processing a step, a step's result at most 1 MiB. One query: at most 100 bound values, a value at most 2 MB.

## Decisions the design left to the build

- **Groups.** A list is worked 40 rows at a time, each group through every stage before the next begins: doors, search, second knock on the doors that failed, search again where a second knock changed the address, reading, verdict. Doors on the wall therefore light up group by group, and a list that stops has whole rows finished.
- **Run ids carry an attempt number**: `<list>-a<attempt>-g<group>-<stage>-<turn>`. "Carry on" raises the attempt, so a run that died can be replaced, and a run from an older attempt stops at its next step.
- **Only findings are stored**, not pages: what the door said, the links found, the dates. A row's signs are a few hundred bytes.
- **A second knock** goes to doors that answered with an error, timed out, did not resolve, or could not be asked. Not to doors that block readers.
- **Search windows.** Last 12 months; if nothing, 12 to 36 months; if nothing, any time. Dates arrive as "May 7, 2026": they are parsed strictly, an unknown shape is no date, and a hit on another site is dropped.
- **The newest hit is read.** When the page states its own date, that date is used and named "the page's own date"; otherwise the index's date is used and named "date from search". When the page's own date falls outside the window, the next hit is read as well.
- **Reading allowance.** Knock counts the pages it reads successfully. 800 a day are free to it (the account has 1,000, and I use it for other things). Beyond that a list waits for midnight UTC, or, with the cap above 0, reads on at $0.001 a page up to $2.
- **Search pace.** Seven a minute across all lists, counted in the database. I planned 25. On 12 November TinyFish's price list gave Search as 30 a minute and 500 an hour; seven a minute stays under both with one counter, and the wall keeps moving instead of stopping for most of an hour. Raising it is one number in `limits.ts`.
- **A leg's database queries.** The free plan allows one run 50. A leg counts what its turns can cost at most and hands over at 40.
- **One bad address costs one row.** A row whose Fetch call failed as a whole is asked alone the next time. A step that breaks even on its second try counts a try for its rows, and the leg carries on.
- **The second knock.** After an error it asks the address under the other of http and https. A door that could not be asked in three tries gets one more ask here.
- **A newest page that cannot be used.** When the newest page Search lists could not be read, or leads to another site, the next one is read. The first ten real rows showed why: a large company's newest listed page forwarded to its status site, and the row came out "slowing down".
- **A date from Search alone.** A page Search lists but that could not be read today still gives the row its "last seen", named "date from search", and the row's sentence says the page could not be read. It never decides a verdict.
- **One key.** Knock uses my second TinyFish account for everything.

## What 46 real rows showed (12 November, on my machine, free calls only)

Before any deploy I ran a sample from the earlier probe through the whole pipeline in the local runtime: 11 companies Y Combinator lists as inactive whose home page still loads, 18 it lists as bought, 17 it lists as running. All 46 got a verdict, across two groups of rows, and no step failed.

| Y Combinator's record | alive | slowing down | zombie | could not tell |
|---|---|---|---|---|
| Inactive (11) | 1 | 3 | 5 | 2 |
| Bought (18) | 7 | 4 | 7 | 0 |
| Running (17) | 12 | 4 | 0 | 1 |

What I take from it, to settle on the full list where the verdicts can be decided again from the stored signs without asking anything twice:

- **The page's own date is the day it was first published.** A running company's product page said January 2024 while Search dated it this month, and the row came out "slowing down". The same rule rightly caught two dead sites whose old pages had been crawled again. What separates them in this sample is how many dated pages Search lists in the window: ten for the running company, one for each dead site.
- **A date from Search alone carries most "alive" verdicts**: 8 of the 12 running rows. It also made the one inactive row alive, on a privacy page. Legal pages are often the newest page Search lists.
- **A dead company whose site still loads is mostly not caught by the free signs**: 5 of 11 came out zombie. This is what TinySet is for.
- A page that was read but led to another site is reported as "could not be read today". The wording is wrong; the verdict is not.

## Things most likely to bite a visitor, each pinned by a test

1. A CSV saved by Excel: a byte-order mark, CRLF line ends, semicolons or tabs between cells.
2. Addresses written loosely: `stripe.com`, `WWW.Stripe.com/`, `http://stripe.com/about`, and things that are no address: an email, `n/a`, `-`, an empty cell.
3. A sheet with names only, or with the same company twice.
4. A file that is empty, has a header only, has more than 1,000 rows or is too large: refused with a sentence that says why.
5. Names and cells in other scripts and with accents: returned byte for byte, and matched without breaking.

---

## Slice 1: the free core

Nothing in this slice can spend. At its end: a deploy with the cap at 0, 20 real rows, then the whole 590.

### Task 1: the frame

**Files:** `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.jsonc`, `.gitignore`, `LICENSE`, `migrations/0001_init.sql`, `src/index.ts`, `src/env.ts`, `src/app.tsx`, `src/core/limits.ts`, `tests/setup.ts`, `tests/env.d.ts`, `tests/helpers/fetch-mock.ts`, `tests/frame.test.ts`.

- `Env`: `DB`, `ASSETS`, `TINYFISH_API_KEY`, `ADMIN_TOKEN`, `SPEND_CAP_USD?`, `LIST_WORKFLOW: Workflow<ListParams>`, `PUBLIC_BASE_URL`.
- Tables: `lists`, `rows` (key `list_id, n`), `limits` (key `day, name`), `spend`, `sets`, `waves`.
- Test: the migration applies and `GET /api/stats` answers `{ lists: 0, rows: 0, spend_usd: 0 }`.

### Task 2: reading and writing a sheet

**Files:** `src/core/csv.ts`, `src/core/columns.ts`, `tests/csv.test.ts`, `tests/columns.test.ts`.

- `parseCsv(text: string): string[][]` (quotes, doubled quotes, commas and line breaks inside cells, CRLF, a byte-order mark, empty lines dropped, the separator found from the first line: comma, semicolon or tab).
- `toCsv(rows: string[][]): string` (CRLF, quotes only where needed). `parseCsv(toCsv(x))` gives `x` back.
- `guessColumns(header: string[], sample: string[][]): { name: number; address: number | null }` from the header's words (company, name, startup, organisation; website, url, domain, site, homepage, link), then from what the cells hold.

### Task 3: addresses, names and dates

**Files:** `src/core/address.ts`, `src/core/names.ts`, `src/core/dates.ts`, tests of the same names.

- `cleanAddress(raw: string): string | null` gives `https://host/path` or null for no address. `hostOf(url)`, `siteOf(host)` (the registrable part, with a short list of two-part endings such as `co.uk`), `sameSite(a, b)`.
- `nameKey(name)` (letters and digits, lower case, any script), `namesCompany(text: string, name: string): boolean` (the name as a whole word, or its key inside a host).
- `searchDay(v: unknown): string | null` ("May 7, 2026", "7 May 2026" and ISO forms give `2026-05-07`; anything else null), `monthsAgo(day, today): number`, `httpDay(v)` for the server's date.

### Task 4: the door

**Files:** `src/core/signs.ts` (the types of every sign), `src/core/door.ts`, `tests/door.test.ts`, `tests/fixtures/doors.json` (real answers saved from the 100-site probe, cut short).

- `readDoor(read: PageRead, name: string, address: string): DoorSign`. Kinds: `answers`, `forwards` (with the host it leads to and whether the page there names the company), `for_sale`, `nearly_empty` (under 400 characters), `gone`, `error`, `blocked`, `timed_out`, `no_address`, `not_asked`.
- `findLink(links: string[], kind: "jobs" | "signup", site: string): string | null`.
- Tests from the fixtures: one that loads, one that forwards and names the company, one that forwards and does not, one for sale, one nearly empty, and each kind of failure.

### Task 5: new pages

**Files:** `src/core/pages.ts`, `tests/pages.test.ts`.

- `newestHit(results: unknown[], site: string, today: string): Hit | null` (only hits on the company's site, strict dates, none in the future, the newest).
- `nextWindow(asked: Window | null, found: boolean): Window | null` over `"12" | "36" | "any"`, and `windowDates(w, today): { after?: string; before?: string }`.

### Task 6: the verdict

**Files:** `src/core/verdict.ts`, `tests/verdict.test.ts`.

- `decide(signs: Signs, today: string): Decision` with `Decision = { verdict, rule, lastSeen, lastSeenFrom, why, evidence }`. The nine rules of the design, first match wins, thresholds from `limits.ts`.
- Tests: every row of the table in section 5 of the design, each rule on its own, and that a link that could not be read today decides nothing.
- `src/core/sheet.ts`: `knockCells(row): string[]` and `KNOCK_HEADER`, the thirteen columns that come back. No cell of Knock's begins with `=`, `+`, `-` or `@`.

### Task 7: the TinyFish calls

**Files:** `src/tinyfish/client.ts`, `src/tinyfish/fetch.ts`, `src/tinyfish/search.ts`, `src/tinyfish/wallet.ts`, `tests/tinyfish.test.ts`.

- `readPages(env, urls: string[]): Promise<{ ok: true; pages: PageRead[] } | { ok: false; error: string }>`: live reads (`ttl: 0`), with links and the server's date, at most 5 addresses. A call that fails as a whole is `ok: false`.
- `searchSite(env, query: string, host: string, dates): Promise<{ ok: true; results: unknown[] } | { ok: false; error: string }>`.
- `readBalance(env): Promise<number>`, as in Upstream.

### Task 8: lists and rows in the database

**Files:** `src/list/store.ts`, `src/list/create.ts`, `tests/store.test.ts`.

- `createList(env, input: { title, source, csv, nameCol?, addressCol?, owner }): Promise<{ id } | { refused: string }>`: reads the sheet, cleans every address, writes all rows in a few statements, marks rows without an address.
- `loadGroup(db, listId, group): Promise<RowState[]>`, `saveRows(db, listId, patches: RowPatch[]): Promise<void>` (one statement), `takeMany` and `countUp` for the daily counters, `wallOf(db, listId)`.
- Tests: 1,000 rows are written with fewer than ten queries; a patch changes only what it names.

### Task 9: the legs

**Files:** `src/list/stages.ts` (what each stage owes and does), `src/list/run.ts`, `src/list/workflow.ts`, `src/list/carry.ts`, `tests/pipeline.test.ts`, `tests/workflow.test.ts`.

- `type Leg = { group: number; stage: Stage; turn: number }`, `Stage = "doors" | "search" | "doors2" | "search2" | "read" | "verdict"`.
- `runLeg(env, listId, attempt, leg, step): Promise<void>` works stages in order while it has calls left (18 a leg, four reads at a time), then hands over. A leg whose attempt is no longer the list's stops.
- `legId(listId, attempt, leg)`, `handOver(env, listId, attempt, leg)`, `carryOn(env, listId, now): Promise<"started" | "still working" | "done">` (only after ten minutes without movement).
- Tests, with a stand-in world of pages and search answers and a stand-in Workflow that refuses an id it has seen: a list of 90 rows finishes with a verdict on every row; no leg passes 40 outside requests with every step tried twice; a refused search and a failed Fetch call leave the row owed, and after three tries say "could not be asked"; a list stopped in the middle carries on and finishes; an old attempt stops; the reading allowance makes a list wait and say so.

### Task 10: the way in and the way out

**Files:** `src/app.tsx`, `src/list/csv-out.ts`, `src/site/layout.tsx`, `src/site/list.tsx`, `tests/routes.test.ts`.

- `POST /api/lists`, `GET /api/lists/:id`, `GET /api/lists/:id/rows`, `GET /api/lists/:id/csv`, `POST /api/lists/:id/carry-on`, and plain pages `/` and `/l/:id` that show counts and what is being done now.
- At most three new lists a day from visitors; my own lists come in with the admin token.
- Tests: a sheet goes in and the same cells come back with the thirteen columns added; each refusal says why.

### Task 11: on the real plan

Deploy with the cap at 0 (my own yes first). Then, in this order: 20 rows; read the Workflow runs for processing time and request counts; stop a run in the middle and carry on; all 590. What I measure sets the sizes left open in the design.

#### What the first live run showed (12 November 2026, cap at 0)

- The same 46 rows as the sample above, handed in to the live site: every row had a verdict after 16 minutes, in 9 Workflow runs and 199 steps. No step needed its second try, no run failed, and the most calls any one run made to other hosts was 18, against the 50 the free plan allows. Cloudflare's record gives each step's time and tries but not a count of database queries, so what I can say there is that no run was stopped for passing a limit.
- The search pace held: 99 searches over 17 minutes, never more than 7 in one minute, and TinyFish's own record for the same window shows 99.
- A second list of ten rows, whose run I stopped by hand in the middle of its searches: "Carry on" refused until the list had stood still for ten minutes, then started it again where it stopped, and it finished with a verdict on every row. The second attempt repeated none of the first knocks and none of the searches whose answers had been saved: it made the 9 searches still owed, the one second knock still owed, and 3 calls to read pages. A second press was refused.
- 42 of the 46 verdicts were the same as on my machine two hours earlier. The four that differ (Bright, Open Motors, PartnerStack, Meter Feeder) differ because Search listed different pages the second time, not because anything broke. A verdict that rests on one search can change from one day to the next; that goes with the rules to tune after the 590.
- TinyFish recorded 142 pages for the two lists and Knock had counted 126: the other 16 were pages TinyFish tried and could not read. Knock now counts those too. A call that failed as a whole, and a page TinyFish gave no answer for, are still not counted, and I do not know whether TinyFish charges for a page it could not read, so the wallet stays the check on the spend line.
- The database read 16,884 rows and wrote 952 for these 56 rows, my own checks included. The free plan allows 5 million rows read and 100,000 written a day.
- The wallet did not move during the run.

#### What the 590 showed (12 November 2026, cap at 2)

- All 590 rows of Y Combinator's 2014 to 2016 batches had a verdict after 2 hours 57 minutes: 86 Workflow runs, 2,301 steps, 1,329 calls to TinyFish, no step tried twice, no run failed. 1,142 searches, never more than 7 in a minute; 1,444 pages by Knock's count.
- It cost nothing. TinyFish recorded 1,268 pages read on the account that day, 268 past its free thousand, and the wallet did not move. Knock had booked those pages at $0.001 each as it read them ($0.64); I took that out of the books when the wallet showed it was never charged. Searches were not charged either.
- Free signs only, against Y Combinator's own record, which Knock never saw:

| The record says | Alive | Slowing down | Zombie | Could not tell |
|---|---|---|---|---|
| Running (244) | 185 | 18 | 17 | 24 |
| Bought (162) | 47 | 17 | 60 | 38 |
| Gone (184) | 9 | 6 | 73 | 96 |

- The zombies that the record says are running, by the rule that decided: for sale 0 of 16, address gone 4 of 53, forwards to a site that does not name it 4 of 23, newest date over three years 6 of 24, nearly empty 3 of 34. The date rule is the weakest: the index does not know every new page.
- Of the 158 "could not tell", 58 had no address at all and 76 answered with an error, blocked the reader or did not answer. Those are rows only an outside source can decide.
- A fault the run showed, fixed the same day: every save walked all the rows of its list, and every page view counted every row in the database. The database read 2.2 million rows that day, 44% of what the free plan allows all of my projects together. A save now goes straight to its rows and the totals are read from the lists' walls.

## Slice 2: TinySet

### Task 12: sets

**Files:** `src/tinyfish/datasets.ts`, `src/outside/spec.ts`, `src/outside/match.ts`, tests.

- `specFor(rows: { name; address }[]): Spec` (the list in the description, the name as key, a row without an address written as "no website known"); two rows with the same name never share a set.
- `matchRows(sent, returned): { matched: Map<number, OutsideSign>; offList: string[]; missing: number[] }`.
- A source on Y Combinator's own site is shown and decides nothing, so the scoring against that record stays clean.

### Task 13: waves and the books

**Files:** `src/outside/pick.ts`, `src/outside/wave.ts`, `src/outside/book.ts`, `tests/outside.test.ts`.

- A wave claims its rows and saves each empty dataset's id before any paid fill. The fill step reads the dataset first and never posts a second fill for one already running or done.
- The wallet is read before a wave and ten minutes after its last set ends; the wave is booked at its fall, never more than its rows at the rate card, and at the rate card when the wallet cannot say.
- Tests: "the fill was posted and the step then failed" starts no second fill; "Carry on" during a wave reads the set again; nothing starts when the wallet cannot be read or the cap could be passed; a refill happens once.

### Task 14: the gate

Deploy with the cap at 20 (my own yes first). Fifty rows mixed on purpose through `POST /api/admin/lists/:id/wave`. It passes with at least 35 usable rows and none from outside the list. Upstream's traces run first, and I check Upstream's "charged" mark after each wave.

#### What the gate showed (12 November 2026, cap at 20)

- Fifty rows chosen from the finished 590 without looking at the record: 12 that forward elsewhere, 8 with no address, 8 whose address is gone, 8 that gave an error or blocked the reader, 6 nearly empty, 8 that answer and show nothing new.
- First a set of two rows, to prove every step on the real platform: made, filled once, read back, sources read, decided, booked at $0.10, which is what the wallet fell by.
- Then the other 48. All 48 came back under their own names and sites after one refill; none from outside the list. Booked at $2.70, again exactly the wallet's fall. Fifty rows cost $2.80, not the $5 of the rate card.
- **Pass:** 41 of 50 usable (a source Knock read itself, which names the company, not on Y Combinator's site); the bar was 35. No link was on Y Combinator's site.
- 30 verdicts now rest on what TinySet found. Of the 50, 18 changed: 12 from "could not tell" to zombie, 2 from "could not tell" to slowing down, 2 from slowing down to zombie, 1 from slowing down to alive, 1 from zombie to slowing down. Among the rows the record calls gone, "could not tell" fell from 6 to 2; among the bought, from 8 to none.
- What it did not fix: two running companies stay zombie because TinySet said "operates" without a link Knock could read (Assembly, Pave), and one because its latest activity is from 2020 (Emailio). A claim without a readable source decides nothing, by design.
- Knock still books the pages it reads beyond its free 800 at $0.001 each, and TinyFish still did not charge them: I settle the books against the wallet after each of my own runs.

#### Two more sets on the same day (12 November 2026)

- **The 50 rows with no address.** 47 came back after one refill, 3 never did, none from outside the list. 30 are usable; 17 came back with a claim and no source Knock could read, and stay "could not tell". TinyFish charged nothing for this set: the wallet had not moved ten minutes after it ended, nor seventeen minutes after, so it is booked at $0. Every row of it has an empty website, which may be why; I do not know the rule.
- **Fifty mixed rows:** 17 doors that forward to a site that does not name the company, 15 whose newest date is over three years old, 17 that blocked the reader or did not answer, 1 error. All 50 came back, none from outside the list, 36 usable. Booked at $2.90, the wallet's fall.
- **The books:** four sets, 150 rows, $5.70 in all, which is what the wallet lost that day (34.982 to 29.282). About four cents a row, against the ten of the rate card.
- **The list after it,** against the record:

| The record says | Alive | Slowing down | Zombie | Could not tell |
|---|---|---|---|---|
| Running (244) | 186 | 22 | 17 | 19 |
| Bought (162) | 47 | 16 | 79 | 20 |
| Gone (184) | 9 | 6 | 108 | 61 |

- "Could not tell" fell from 158 rows to 100, and the gone companies Knock calls zombie rose from 73 to 108. 79 verdicts now rest on TinySet's finding with a source Knock read.
- **What it showed about the rules.** Seventeen running companies are still zombie. Three of them are zombie because TinySet found a shutdown or a merger with a source (Cleanly, DemocracyOS, Flirtey): there the record may be the one that is out of date. Eight were asked and TinySet said "operates", but with no link Knock could read or only an old one (Fountain, Assembly, Stealth Worker, Emailio, MagicBus, Protonet, Pave, BuildScience). Six were not asked. Fountain is the plain mistake: its own pages carry only an old date, TinySet says it operates, and the link it gave could not be read. A claim that cannot be read decides nothing, but it should make Knock say "could not tell" and not "zombie". That is the rule to change.
- A renamed company is not caught as alive: TinySet said Plate IQ is now Ottimate and gave a page of ottimate.com, which does not name Plate IQ, so the link did not count.

#### Tuning the rules on the 590 (12 November 2026)

- I saved the signs of all 590 live rows and ran the verdict code over them unchanged first: it gave back every row exactly as the live list holds it, 0 of 590 different. Only then did I change a rule.
- What I measured and left alone: an old date with an open door and a jobs or sign-up page (5 rows: 2 running, 3 gone) and a nearly empty home page (30 rows: 3 running). Neither separates the living from the dead.
- What I changed: an unsourced "operates" from TinySet now stands in the way of "zombie"; a page on the site an address now leads to counts once a source naming the company was read; the day of a rename or purchase of a company that still runs is a dated sign; and a sentence that said "nothing on the site carries a date" names the listed page that could not be read.
- On the saved signs the new rules change 13 rows and no others: Assembly, Fountain, Stealth Worker and Pave (running by the record) go from zombie to "could not tell"; Plate IQ and Verge Genomics (running, both renamed) go from slowing down to alive; VINEBOX, Monthli and Ubiq (gone by the record) go from zombie to "could not tell"; four sentences are reworded.
- After it, against the record: running 244: alive 188, slowing down 20, zombie 13, could not tell 23. Gone 184: alive 9, slowing down 6, zombie 105, could not tell 64. Bought is unchanged.
- The rules were changed after I had seen the record, so this is a score on the list they were tuned on, not a test of them.
- Not fixed: a name with a part in brackets, as "VINEBOX (Usual Beverage Co.)", is looked for whole on a page and so is seldom found there.

#### One more set: the thin pages and some dead addresses (12 November 2026)

- **The rows,** by a rule written before any name was looked at: all 32 rows whose home page is nearly empty and that were in no set, and 18 of the 45 whose address no longer exists, spread evenly over the sheet. All 50 were zombie by the free signs.
- **How I said I would read it,** also before: the hard line is "no row from outside the list", and the count of usable rows is a number, not a bar.
- **What came back.** 49 of 50 after one refill. One name came back that is not on the list as written: "Kenota", for the row I sent as "Kenota (formerly ExVivo Labs)". By the letter of my line that is one off the list, and my own check prints FAIL for it. No other company came back; it is the list's own row 535 under its short name, and Knock threw it away, so that row says "TinySet returned nothing". 28 rows are usable, against the 35 the gate asked of a mixed set. The other 21 came back without a source Knock could use, 18 of them with no link at all: for a dead company TinySet often says "no longer operates" and gives nothing to read.
- **The books.** $1.60, which is what the wallet fell by (29.282 to 27.682): about three cents a row. Five sets, 200 rows, $7.30 in all, and the wallet has lost $7.30 since the morning (34.982 to 27.682). Three lines for pages, $0.04, were not charged and are out of the books.
- **What changed.** 16 of the 50 are now zombie by rule 1, on a shutdown or a purchase with a source Knock read, where before they rested on an empty page or a dead address. Four verdicts changed: Roomstorm (running) from zombie to slowing down, Tara AI and Carbic (running) from zombie to "could not tell", and Seerslab (gone by the record) from zombie to alive, on a newspaper article of April 2026 that names it.
- **The six running companies that had never been asked** all fell in this set, by the rule and not by choice: Roomstorm, Tara AI and Carbic as above; Pushbullet and Zidisha stay zombie, because TinySet says they operate and the newest date anyone could show is from 2022 and 2018; Notable Labs stays zombie, now on a shutdown in October 2024 with a source.
- **The list after it,** against the record:

| The record says | Alive | Slowing down | Zombie | Could not tell |
|---|---|---|---|---|
| Running (244) | 188 | 21 | 10 | 25 |
| Bought (162) | 47 | 16 | 79 | 20 |
| Gone (184) | 10 | 6 | 104 | 64 |

- **The ten running companies still zombie.** Four have a shutdown or a merger with a source that Knock read (Cleanly, DemocracyOS, Flirtey, Notable Labs): there the record may be the one that is out of date. Five are said to operate, and the newest date anyone could show is more than three years old (Emailio, Pushbullet, Zidisha, MagicBus, Protonet). One has a home page last changed in 2015, and TinySet says it no longer operates (BuildScience).
- **Not asked:** 27 addresses that no longer exist, 16 that are for sale, and 73 rows that say "could not tell" (51 of them answered with an error).
- The deciding-again that follows a set ran on the tuned rules: the saved signs of all 590 rows give back the live list, 0 different.
- This is still a score on the list the rules were tuned on.

## Slice 3: the board

- **Task 15.** The pages in the look I chose: the wall, the departure board, a row's page, the working state.
- **Task 16.** "Knock on one door": `POST /api/knock`, ten an hour for a visitor.
- **Task 17.** A Google Sheet link, and the preview that lets a visitor change the two columns.
- **Task 18.** How it works, the API page, the stats, the spend at the foot.
- **Task 19.** Scoring against Y Combinator's record, a second list of about 100 rows, and a stranger's visit.

## Slice 4: handing it in

The README, the runbook, the build log, the film (sample styles first), the form notes and the posts.
