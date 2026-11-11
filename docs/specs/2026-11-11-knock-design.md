# Knock: design

11 November 2026. For the TinyFish Student Bounty Drop 002, bounty "Zombie Check" (closes 17 November).

## 1. What it is

A list of companies goes stale without anyone noticing: the company is still on the sheet, but nobody is home. Knock takes a spreadsheet of 500 or more companies, knocks on every door, and hands the same sheet back with three things added to every row: a verdict (alive, slowing down or zombie), the date the company was last seen doing something, and links to the evidence.

The name comes from the bounty's own words for a zombie: "still listed, but nobody home".

## 2. What it must do, and what it must never do

**Must (the bounty's requirements):**

1. Take a CSV or a Google Sheet of at least 500 rows.
2. Check at least four signs of life for each row, from live pages.
3. Return the same spreadsheet with new columns: the verdict, the date of the latest activity found, links to the evidence.
4. Be shown on a real list.
5. Use TinySet, and say how.

**Must (what the judges approve on):** every verdict shows its evidence with links; the signs come from live pages and not from a stored database; redirects, takeovers, new names and parked addresses are handled correctly; it finishes the whole list and can carry on if it stops partway; it works on any list.

**Not in this build:** accounts and sign-in; checking job posts for ghost jobs; watching a list over time; filling in anything about a company beyond its signs of life.

**Never:**

- A verdict without evidence.
- A guess written as a fact. When Knock cannot tell, the row says "could not tell" and why.
- A fact taken from memory or from Y Combinator's record. That record is only used afterwards, to score Knock.
- Money spent that I did not agree to.

## 3. What I tested before designing (all on 11 November)

**TinySet keeps to a list I give it (paid, $0.90).** TinySet finds its own rows; there is no way to hand it mine. But with the twelve company names and addresses written into the dataset's description, the run opened one search per listed name. First fill: 11 of 12, none off the list, every address right. A second fill brought the twelfth back. 19 of its 20 evidence links were read live afterwards and named the company. Cost: $0.075 a row (the rate card says $0.10). A row can be dropped with no reason given, so a second fill is part of the design.

**What a company's own home page tells (free, 100 real companies).** From Y Combinator's 2014 to 2016 batches: 40 it lists as running, 30 as gone, 30 as bought.

| The home page | Running | Gone | Bought |
|---|---|---|---|
| Loads | 33 | 8 | 7 |
| Forwards to another company's site | 2 | 1 | 9 |
| Nearly empty | 0 | 2 | 2 |
| Could not be read | 5 | 19 | 12 |

- A page that loads does not tell a living company from a dead one: eight "gone" companies still load.
- A forward to another company's site is itself evidence: nine of the bought companies now lead to their buyer.
- Of the 36 that could not be read, 14 are addresses that no longer exist, 11 answer with an error, 4 time out, 2 block the reader, 5 other.
- One row had an empty address. It made the whole call for ten addresses fail. So every address is checked before it is sent.

**Dates on a company's own pages are hard to read directly (free).** Of 16 blog pages, 3 gave a date in their text. A sitemap comes back from Fetch without its dates. The publish date of the newest post was found for 7 of 18 sites.

**Search limited to the company's own site is the dated signal that works (free, 26 sites).** I asked TinyFish Search for pages on the company's own address dated in the last twelve months. Of 12 running companies, 9 had such pages, each with its date. Of 8 "gone" companies whose site still loads, 7 had none. This is free, the same for every row, and each hit is a page Knock can then read live.

**Cloudflare's free plan allows one Workflow run 50 requests to other hosts.** A list is therefore worked in short legs, as Upstream is.

## 4. How one row is checked

Each row gets up to six signs. The first five are free and come from the company's own pages.

| Sign | Where it comes from | What it says |
|---|---|---|
| The door | Fetch reads the home page | It answers; or it forwards to another site (which one); or it is parked or for sale; or it is nearly empty; or it could not be read, and why |
| New pages | Search limited to the company's own address, last twelve months; Fetch then reads the newest hit | The date of the newest page and a link to it, or "nothing new in twelve months" |
| Hiring | A link from the home page to a jobs page or a jobs board; Fetch reads it | The page is there and lists openings; or there is none |
| Sign-up | A link from the home page to sign up, log in or see prices; Fetch reads it | New customers can still get in; or the door is shut |
| The page's own date | The date the server gives for the home page | Used only when it is older than twelve months: a site nobody has touched |
| What others say | TinySet (section 6) | Bought, merged, renamed or shut down, by whom and when, with a source; and the latest public activity, with a link |

Every link Knock shows was read on the day of the check. A link from TinySet is read with Fetch before it is shown; one that cannot be read is shown as "given by TinySet, could not be read today".

## 5. The verdict

Rules, first match wins. The thresholds are mine and sit in one file.

1. **zombie**: a source says the company shut down; or its address is gone, parked or for sale and nothing shows life in the last 24 months; or it was bought and its address now forwards to the buyer with nothing of its own left.
2. **alive**: something dated in the last 12 months, on its own site or reported by TinySet with a link, and nothing says it shut down. A company that was bought or renamed but still runs is alive, and the row says "bought by X" or "now called Y".
3. **slowing down**: the site answers but the newest dated activity is 12 to 36 months old; or nothing dated was found although sign-up or jobs pages are still up.
4. **zombie**: the newest dated activity is more than 36 months old.
5. **could not tell**: the site could not be read for a reason that is not death (it blocks readers, it timed out twice) and nothing else was found. The row says which.

Each row also gets one plain sentence saying why, for example: "The address forwards to quorum.us. TinySet: bought by Quorum in 2021 (source). Nothing of its own since."

## 6. TinySet's part

TinySet fills in what a company's own site cannot say about itself, for hundreds of rows, each value with its source.

- **Which rows.** In this order: rows whose address forwards elsewhere (only an outside source can tell a new name from a takeover), rows whose site is gone, parked, nearly empty or unreadable, rows with no address, and then rows whose site loads but shows nothing new.
- **How.** Rows go in sets of 50. The names and addresses are written into the dataset's description, which is what made TinySet keep to the list in the test. Columns: the company (key), its address (unique), whether it still operates, what happened to it, when, the source of that, the date of its latest public activity, and a link to it. Three sets run at once, which is TinySet's limit.
- **Dropped rows.** A set is filled a second time for rows that did not come back. A row that still does not come back is marked "TinySet returned nothing".
- **Checking it.** A row whose name or address does not match the one sent is thrown away. Every source link is read live before it is shown.
- **Money.** Section 9.

## 7. How it runs

One Cloudflare Worker on the free plan: Hono for the pages and the API, D1 for the lists and rows, Workflows for the work. No queue, no cron.

- **Taking a list in.** A CSV file, or the link of a Google Sheet that anyone with the link can view (Knock reads its CSV export). Knock shows the first rows and which two columns it takes for the name and the address, found from the headers or from what the cells hold; the visitor can change them and then starts the check. A row with no usable address is kept and marked "no address given". At most 1,000 rows.
- **Legs.** The work is cut into legs, each a Workflow run that makes at most 40 requests to other hosts and then hands over to the next:
  - door legs read home pages, five addresses to a call;
  - search legs ask for new pages, one company to a request, within Search's 30 a minute;
  - reading legs read the newest hit, the jobs page and the sign-up page;
  - TinySet legs start a set, read it every 30 seconds, read its links and hand over;
  - a last leg decides the verdicts and does the books.
- **Stopping and carrying on.** Every row records how far it has got. A leg takes the next rows that are not done, so a list that stopped carries on where it was. A hand-over uses a run id built from the list's, so one that is tried twice starts one run. The list's page has a "Carry on" button for a list that has stood still.
- **While it works.** The list's page shows the wall of doors: a door takes its light when its row is done, and a line says what is being done now and how many rows are finished.
- **Little processing per step.** The free plan allows a step very little processing time, so a step parses one page, and pages are cut to their first 20,000 characters and 300 links before they are stored.

## 8. What a visitor sees

The look is the one I chose: a board of tiles in white, navy and one small orange (family/knock/direction-notes.md).

- **First page.** The name, the wall of 590 doors from the Y Combinator list with Knock's own verdicts, "Knock on one door" (type one address, get its free signs), and the tile that takes a spreadsheet.
- **A list's page.** The wall, the counts, the rows as a departure board (name, last seen, the evidence, the verdict on a solid block), filters by verdict, the download, "Carry on".
- **A row's page.** The door, the verdict and its one sentence, each sign with its link and when it was read, and what TinySet said with its sources.
- **The sheet that comes back.** The visitor's own columns, untouched and in their order, then: `knock_verdict`, `knock_last_seen`, `knock_evidence_1` to `_3`, `knock_why`, `knock_site`, `knock_what_happened`, `knock_checked_on`.
- **How it works, and the API.** `POST /api/lists`, `GET /api/lists/:id`, `GET /api/lists/:id/rows`, `GET /api/lists/:id/csv`, `POST /api/knock` for one address, `GET /api/stats`.
- Every page carries "Built by Hamdan Esmail", linked to my GitHub.

## 9. Money

- **Free:** Search, and Fetch up to 1,000 pages a day on the account. The 590-row list needs about 1,500 page reads, so it is spread over two days or the extra 500 are paid for at $0.001 each ($0.50).
- **TinySet:** $0.075 a row as measured, $0.10 by the rate card. I count on the rate card.
- **The demo list.** About half of an old list needs TinySet (in the test: 36 unreadable, 12 forwarded, 4 nearly empty of 100). For 590 rows that is about 300 rows: about $23 as measured, $30 by the rate card.
- **Lists from visitors.** Free signs for every row. TinySet for at most 25 rows of a list, the ones that need it most, while a fixed reserve lasts; after that the list is checked with the free signs only, and its page says so. At most three new lists a day from all visitors together.
- **The books.** The wallet is read before each TinySet set and ten minutes after it ends. The fall is booked, and never more than the rows asked for at the rate card. A set is not started when the wallet cannot be read, when it would pass the list's cap, or when the reserve is used. Spend is shown at the foot of every page.

## 10. How I will know it works

- **Tests, none touching the network:** the CSV reader (quotes, commas and line breaks inside cells, empty lines); finding the name and address columns; the signs read from saved real pages (one that loads, one that forwards, one for sale, one nearly empty, each kind of failure); the verdict rules as a table; no leg making more than 40 outside requests; a list that stops and carries on; the money stops.
- **The real list:** all 590 rows, start to finish, with the sheet downloaded and opened.
- **Scoring:** how often Knock agrees with Y Combinator's record, and every row where it does not, with the evidence, read by me one by one.
- **A second, different list** of about 100 rows, to show it is not built for one list.
- **A stranger:** a fresh session given only the address, as I did for Upstream.

## 11. Left open on purpose

- The exact size of each kind of leg, after measuring processing time on real pages.
- The film. I will draw sample styles and choose before making it.
