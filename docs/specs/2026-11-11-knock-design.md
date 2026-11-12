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
- A date without saying where it comes from.
- A fact taken from memory or from Y Combinator's record. That record is only used afterwards, to score Knock.
- Money spent that I did not agree to.

## 3. What I tested before designing (all on 11 November)

**TinySet keeps to a list I give it (paid, $0.90).** TinySet finds its own rows; there is no way to hand it mine. But with twelve company names and addresses written into the dataset's description, the run opened one search per listed name. First fill: 11 of 12, none off the list, every address right. A second fill brought the twelfth back, for another $0.10 that reached the wallet minutes after the run had ended. 19 of its 20 evidence links were read live afterwards and named the company. Not tested: a set larger than 12, companies with little written about them, and names that are also ordinary words.

**What a company's own home page tells (free, 100 real companies).** From Y Combinator's 2014 to 2016 batches: 40 it lists as running, 30 as gone, 30 as bought.

| The home page | Running | Gone | Bought |
|---|---|---|---|
| Loads | 33 | 8 | 7 |
| Forwards to another company's site | 2 | 1 | 9 |
| Nearly empty | 0 | 2 | 2 |
| Could not be read | 5 | 19 | 12 |

- A page that loads does not tell a living company from a dead one: eight "gone" companies still load, and links to a blog, jobs and sign-up sit on them about as often as on the running ones.
- A forward to another company's site is itself evidence: nine of the bought companies now lead to their buyer.
- Of the 36 that could not be read, 14 are addresses that no longer exist, 11 answer with an error, 4 time out, 2 block the reader, 5 other.
- One row had an empty address. It made the whole call for ten addresses fail. So every address is checked before it is sent.

**Dates on a company's own pages are hard to read directly (free).** Of 16 blog pages, 3 gave a date in their text. A sitemap comes back from Fetch without its dates. The publish date of the newest post was found for 7 of 18 sites.

**Search limited to the company's own site is the dated sign that works (free, 26 sites).** I asked TinyFish Search for pages on the company's own address dated in the last twelve months. Of 12 running companies, 9 had such pages. Of 8 "gone" companies whose site still loads, 7 had none. Its limits: the date is the search index's and not always the page's own; some hits are terms or help pages; three running companies had no dated page at all.

**Limits that shape the build.** Cloudflare's free plan allows one Workflow run 50 requests to other hosts, so a list is worked in short legs, as Upstream is. Fetch is free up to 1,000 pages a day; the next one is charged $0.001 without a word. Search is free up to 12,000 a day, 30 a minute. TinySet runs three sets at once.

## 4. How one row is checked

Each row gets up to six signs. The first five are free and come from the company's own pages.

| Sign | Where it comes from | What it can say |
|---|---|---|
| The door | Fetch reads the home page | It answers; it forwards to another site (which one, and whether the page there still names the company); it is for sale; it is nearly empty; the address no longer exists; it answered with an error; it blocks readers; it timed out; no address was given |
| New pages | Search limited to the company's own address, asked for the last 12 months, then 12 to 36 months, then older. Fetch reads the newest hit | The newest dated page and a link to it, or "nothing in 12 months", "nothing in 36 months" |
| A jobs page | A link from the home page to a jobs page or a jobs board; Fetch reads it | The page is there; or none was found |
| A sign-up page | A link from the home page to sign up, log in or see prices; Fetch reads it | The page is there; or none was found |
| The page's own date | The date the server gives for the home page | Used only when it is older than 12 months: a site nobody has touched |
| What others say | TinySet (section 6) | Whether it still operates; bought, merged, renamed or shut down, by whom and when, with a source; the latest public activity, with a link |

Rules for the signs:

- An error or a time-out is read a second time, later, before it counts.
- When the door forwards to a site that still names the company, that site is treated as the company's new address, and "new pages" is asked there.
- "New pages" is asked even when the home page could not be read: the index may still know the site.
- A jobs page or a sign-up page only says the page exists. They support a verdict and never decide one against a dated sign.
- **Every date says where it comes from:** "the page's own date" when the page read today states it, "date from search" when only the index gives it, "from TinySet's source" when the source page read today states it.
- Every link Knock shows was read on the day of the check. A link from TinySet that cannot be read is shown as "given by TinySet, could not be read today" and decides nothing.

## 5. The verdict

First match wins. The thresholds are mine and sit in one file.

1. **zombie**: TinySet says the company no longer operates, and its source was read. Whatever carries the name today (an open-source project, a buyer's product page) does not change that.
2. **zombie**: the address is for sale.
3. **zombie**: the address no longer exists, and nothing says the company operates under another.
4. **zombie**: the address forwards to a site that does not name the company, and nothing says it still operates.
5. **alive**: a dated sign from the last 12 months: a new page on its own or its new address, or an activity TinySet reports with a readable link. A company that was bought or renamed and still runs is alive, and the row says "bought by X" or "now at Y".
6. **slowing down**: the newest dated sign is 12 to 36 months old; or nothing dated was found, but the door answers and a jobs or sign-up page is there; or TinySet says it operates and nothing is dated.
7. **zombie**: the newest dated sign is more than 36 months old.
8. **zombie**: the page is nearly empty and nothing else was found.
9. **could not tell**: everything else, with the reason: the site answered with an error twice and the index knows nothing of it; it blocks readers; no address was given and TinySet returned nothing.

Each row also gets one plain sentence saying why.

The rules walked through rows I already hold:

| Company | What Knock holds | Verdict |
|---|---|---|
| Stripe | The door answers; a blog post of 5 Nov 2026 | alive (rule 5) |
| Parse | The address forwards to parseplatform.org; TinySet: bought by Facebook in 2013, no longer operates, source read | zombie (rule 1), although the open-source project that carries the name was active today |
| Rdio | TinySet: shut down, assets bought by Pandora, 2015, source read | zombie (rule 1) |
| Airmada | The address forwards to a "domain for sale" page | zombie (rule 2) |
| GovPredict | Forwards to quorum.us, which does not name it | zombie (rule 4); "bought by Quorum" when TinySet says so |
| The Athletic | Forwards to nytimes.com, which names it; new pages there | alive (rule 5), "now at nytimes.com" |
| Tarsnap | The door answers; latest activity 21 Mar 2025 | slowing down (rule 6) |
| Hickory | The door answers, a sign-up page is there, nothing new in 12 months | slowing down (rule 6), or zombie (rule 7) when the newest page is older than 36 months |
| A site that answers with an error, twice | New pages in the index from this year | alive (rule 5): "the home page could not be read today" |
| The same, and the index knows nothing | | could not tell (rule 9) |

A known weakness: a running company whose site shows nothing dated comes out "slowing down". Three of twelve running companies in the test would. The first paid set (section 6) shows whether TinySet corrects this.

## 6. TinySet's part

TinySet fills in what a company's own site cannot say about itself, for hundreds of rows, each value with its source.

- **Which rows, in this order:** rows whose address forwards elsewhere (only an outside source can tell a new name from a takeover); rows with no address; rows whose address no longer exists; rows that answered with an error, blocked the reader or timed out; rows that are nearly empty; and last, rows whose site loads but shows nothing new.
- **How.** Rows go in sets of 50. The names and addresses are written into the dataset's description, which is what made TinySet keep to the list in the test. Columns: the company (key), its address (unique), whether it still operates, what happened to it, when, the source of that, the date of its latest public activity, and a link to it.
- **The first set is a gate.** Fifty rows mixed on purpose: forwards, dead addresses, errors, silent sites, and names that are ordinary words. It must come back with at least 35 usable rows (the name and address match what was sent, and at least one fact has a source that can be read) and no row from outside the list. If not, nothing more is spent and I decide again. Its result also sets the order above.
- **Dropped rows.** A set is filled a second time for rows that did not come back. A row that still does not come back is marked "TinySet returned nothing".
- **Checking it.** A row whose name or address does not match the one sent is thrown away. Every source link is read live before it counts.
- **Keeping the scoring clean.** The sheet sent in carries only names and addresses. A TinySet source on Y Combinator's own site is shown but does not decide a verdict, and such rows are counted apart when I score Knock against that record.
- **Never paid for twice.** A set's rows are claimed in the database, and the empty dataset is made and its id saved, before the paid fill starts. A row belongs to one set. A set is filled once, and refilled once.
- **Money.** Section 9.

## 7. How it runs

One Cloudflare Worker on the free plan: Hono for the pages and the API, D1 for the lists and rows, Workflows for the work. No queue, no cron.

- **Taking a list in.** A CSV file, or the link of a Google Sheet that anyone with the link can view (Knock reads its CSV export). Knock shows the first rows and which two columns it takes for the name and the address, found from the headers or from what the cells hold; the visitor can change them and then starts the check. A row with no usable address is kept and marked "no address given". At most 1,000 rows.
- **Legs.** The work is cut into legs, each a Workflow run that makes at most 40 requests to other hosts and then hands over to the next:
  - door legs read home pages, five addresses to a call;
  - search legs ask for new pages, one request each, within Search's 30 a minute;
  - reading legs read the newest hit, the jobs page and the sign-up page;
  - TinySet legs start a set, read it every 30 seconds, read its links and hand over;
  - a last leg decides the verdicts and does the books.
- **Stopping and carrying on.** Every row records how far it has got. A leg takes the next rows that are not done, so a list that stopped carries on where it was. A hand-over uses a run id built from the list's id, the kind of leg and its position, so one that is tried twice starts one run. The list's page has a "Carry on" button; it starts work only when the list has not moved for ten minutes, and a TinySet set that was already made is read again, never made again.
- **While it works.** The list's page shows the wall of doors: a door takes its light when its row is done, and a line says what is being done now and how many rows are finished.
- **Little processing per step.** The free plan allows a step very little processing time, so a step parses one page, and pages are cut to their first 20,000 characters and 300 links before they are stored.

## 8. What a visitor sees

The look is the one I chose: a board of tiles in white, navy and one small orange (family/knock/direction-notes.md).

- **First page.** The name, the wall of 590 doors from the Y Combinator list with Knock's own verdicts, "Knock on one door" (type one address, get its free signs), and the tile that takes a spreadsheet.
- **A list's page.** The wall, the counts, the rows as a departure board (name, last seen, the evidence, the verdict on a solid block), filters by verdict, the download, "Carry on".
- **A row's page.** The door, the verdict and its one sentence, each sign with its link, its date and where the date comes from, and what TinySet said with its sources.
- **The sheet that comes back.** The visitor's own columns, untouched and in their order, then:
  - `knock_verdict`, `knock_last_seen`, `knock_last_seen_from`, `knock_why`;
  - one column for each sign, so the four or more signs behind a verdict can be seen in the sheet itself: `knock_door`, `knock_new_pages`, `knock_jobs_page`, `knock_signup_page`, `knock_outside`;
  - `knock_evidence_1` to `knock_evidence_3`, `knock_checked_on`.
- **How it works, and the API.** `POST /api/lists`, `GET /api/lists/:id`, `GET /api/lists/:id/rows`, `GET /api/lists/:id/csv`, `POST /api/knock` for one address, `GET /api/stats`.
- Every page carries "Built by Hamdan Esmail", linked to my GitHub.

## 9. Money

One cap for the whole build: **$20**, on my second TinyFish account. Prices are the rate card's.

| What | Most |
|---|---|
| The gate: the first TinySet set, 50 rows | $5 |
| The rest of the demo list through TinySet: 100 more rows, refills counted | $10 |
| Lists from visitors: TinySet for at most 15 rows of a list ($1.50), two lists | $3 |
| Pages read beyond the free 1,000 a day, at $0.001 | $2 |

- **What $20 buys, and what it does not.** About 330 of the 590 rows could use TinySet: 57 with no address, and about half of the other 533. $15 pays for 150 of them. The rest get their verdict from the free signs: "the address no longer exists" is evidence enough for a zombie, and a site that only answers with an error is alive, slowing down or "could not tell" by what the search index knows of it. All 330 would bring the total to about $38.
- **What is cut first** when money runs short: visitors' rows, then sites that load but show nothing new, then sites that answered with an error. Forwards and rows with no address come last.
- **Waves.** Up to three sets run at once, as one wave. The wallet is read before a wave and ten minutes after its last set ends. The fall is booked for the wave, and never more than the rows asked for at the rate card. The next wave starts only after that. Nothing is started when the wallet cannot be read, or when a wave could pass the cap.
- **Reading.** Knock counts its own page reads. Past 1,000 in a day they are paid from the $2; when that is used, a list waits for midnight UTC and its page says so. Searches are never paid for: Knock keeps to 6,000 a day.
- **Visitors.** Free signs for every row. At most three new lists a day from all visitors together, and one address at a time on the first page, ten an hour for a visitor.
- **My other projects.** A visitor's set stays under $2, so it cannot be mistaken for a charged search by Upstream's wallet check, which reads the same wallet. I run the demo's waves when no Upstream trace is running. Before taking all three TinySet slots I check whether Backed's live site uses the same account.
- Spend is shown at the foot of every page.

## 10. How I will know it works

- **Tests, none touching the network:** the CSV reader (quotes, commas and line breaks inside cells, empty lines); finding the name and address columns; the signs read from saved real pages (one that loads, one that forwards and names the company, one that forwards and does not, one for sale, one nearly empty, each kind of failure); the verdict rules as a table, with every row of the table in section 5; no leg making more than 40 outside requests; a list that stops and carries on without a second paid set; the money stops.
- **The gate set** (section 6), before any other paid set.
- **The real list:** all 590 rows, start to finish, with the sheet downloaded and opened.
- **Scoring:** how often Knock agrees with Y Combinator's record, and every row where it does not, with the evidence, read by me one by one.
- **A second, different list** of about 100 rows, to show it is not built for one list.
- **A stranger:** a fresh session given only the address, as I did for Upstream.

## 11. Left open on purpose

- The exact size of each kind of leg, after measuring processing time on real pages.
- Whether sites that load but show nothing new go to TinySet: the gate decides.
- The film. I will draw sample styles and choose before making it.

## 12. Changed while building

- **Search pace (sections 3, 7 and 9).** Knock asks Search seven times a minute across all lists, not up to 30. On 12 November 2026 TinyFish's price list gave Search as 30 a minute and 500 an hour, and seven a minute stays under both. A list of 590 rows therefore takes hours, not minutes, and its page says what is being done the whole time.
- **Reading (section 9).** Knock keeps to 800 pages a day of the account's 1,000, because I use the account for other things.
- **The verdict (section 5), after the 590 and 150 rows through TinySet on 12 November 2026.** Three changes, each tried on the saved signs of all 590 rows before it went live:
  - When TinySet says the company operates and gave no source Knock could read and that names it, rules 3, 4, 7 and 8 no longer say zombie: the row says "could not tell" with both facts. Such a claim still makes nothing alive. Rule 2 (for sale) is unchanged. A claim that it no longer operates, without a source, still changes nothing.
  - A page on the site the sheet's address now leads to counts without naming the company, once a source that does name it was read. This is how a renamed company is seen (Plate IQ, now Ottimate). Without the source it does not count.
  - The day a company that still runs was renamed or bought, read from a source that names it, is a dated sign.
  - These were chosen after I had seen Y Combinator's record of the same rows, so the score on that list is a score on the list the rules were tuned on.
- The other decisions made in the build are listed in `docs/plan.md`, under "Decisions the design left to the build".
