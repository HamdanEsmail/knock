# Runbook

How I deploy Knock, look after it, put rows to TinySet and keep the books right.

## Deploy

One time:

```bash
npx wrangler d1 create knock             # put the id it prints into wrangler.jsonc
npx wrangler d1 migrations apply knock --remote
npx wrangler deploy
npx wrangler secret put TINYFISH_API_KEY
npx wrangler secret put ADMIN_TOKEN      # a long random string
```

Every time after:

```bash
npm run check
npx wrangler workflows instances list knock-list --status running
npx wrangler workflows instances list knock-set --status running
npx wrangler d1 migrations apply knock --remote   # only if migrations/ has a new file; before the deploy
npx wrangler deploy
```

I do not deploy, and I apply no migration, while a list or a set is running. A run hands its work over to the next run, and the next run starts on whatever code is live at that moment. Both lists of running instances must be empty first.

## Settings

| Setting | Where | Meaning |
|---|---|---|
| `PUBLIC_BASE_URL` | `wrangler.jsonc` vars | The address the links in the API's answers are built from. |
| `SPEND_CAP_USD` | `wrangler.jsonc` vars | The most Knock may ever spend at TinyFish, in dollars. $6 of it is kept for pages beyond the free ones (`READS_USD_MAX` in `src/core/limits.ts`), and the rest is for TinySet. With `0` Knock reads free pages only and starts no set. |
| `TINYFISH_API_KEY` | secret | The account everything runs on. |
| `ADMIN_TOKEN` | secret | For the admin routes below. A list handed in with it counts as mine and not against the visitors' three a day. |

Every other number (rows in a sheet, lists a day, the search pace, the free pages a day, the months that make alive and zombie, the rows in a set) is in `src/core/limits.ts`.

## Admin routes

All take `Authorization: Bearer <ADMIN_TOKEN>`.

```bash
# Show a list on the first page as the example, or take it off with ?off=1
curl -X POST "$BASE/api/admin/lists/<id>/feature" -H "authorization: Bearer $ADMIN_TOKEN"

# Remove a list, its rows and its sets
curl -X DELETE "$BASE/api/admin/lists/<id>" -H "authorization: Bearer $ADMIN_TOKEN"

# Apply today's rules to the signs a finished list already holds. Nothing is asked again and nothing is charged.
curl -X POST "$BASE/api/admin/lists/<id>/decide-again" -H "authorization: Bearer $ADMIN_TOKEN"

# Put rows of a finished list to TinySet: the next fifty Knock would pick, or fewer, or exactly the rows named (counted from 0)
curl -X POST "$BASE/api/admin/lists/<id>/wave" -H "authorization: Bearer $ADMIN_TOKEN"
curl -X POST "$BASE/api/admin/lists/<id>/wave" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"count":10}'
curl -X POST "$BASE/api/admin/lists/<id>/wave" -H "authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d '{"rows":[4,17,230]}'

# The sets of a list, newest first, each with its standing and what it was booked at
curl "$BASE/api/admin/lists/<id>/sets" -H "authorization: Bearer $ADMIN_TOKEN"

# Start a set again where it stopped
curl -X POST "$BASE/api/admin/sets/<set id>/carry-on" -H "authorization: Bearer $ADMIN_TOKEN"
```

`decide-again` answers with `rows`, `decided` and `changed`. After a change of rule I run it twice: the second answer must say `changed: 0`.

## A set, from start to books

A set is the only part of Knock that costs money, so no visitor can start one.

1. **Which rows.** Left to itself Knock picks, in this order: doors that forward elsewhere, rows with no address, addresses that no longer exist, doors that gave an error, blocked the reader or did not answer, nearly empty home pages, then doors that answer and show nothing that makes them alive. A row that is already in a set is never picked again, and two rows with the same name never share a set, because the name is the set's key.
2. **Before anything is paid.** The rows are claimed, the wallet is read, and an empty dataset is made whose description holds the list. If the wallet cannot be read, nothing starts.
3. **The fill.** It is asked for once. The step that asks is never tried twice, and it reads the dataset first: one that is filling or filled is left alone.
4. **Looking.** Once a minute, at most 40 times, then the fill is stopped. Rows that did not come back get one more fill.
5. **Reading.** Every source link TinySet gave is read by Knock. The rows are decided again with what was found.
6. **The books.** Ten minutes after the last fill ended the wallet is read again, and the set is booked at its fall, never at more than its rows at the rate card. If the wallet cannot say, it is booked at the rate card.

A set is refused, and nothing is charged, when:

| Answer | Why |
|---|---|
| `409 list_not_done` | The list does not have its free signs yet. |
| `409 list_from_another_day` | The list's pages were read on another UTC day. A set decides its rows again and their sentences say "read today", so the list has to be checked again first. |
| `409 set_in_flight` | Another set is not in the books yet. One runs at a time, so that each one's cost can be read from the wallet. |
| `409 nothing_to_send` | No row is left that TinySet could add to. |
| `402 cap` | The rows at the rate card would pass what the cap leaves for sets: the cap, less $6 for pages, less what sets were booked at. |
| `402 wallet_low`, `503 wallet_unreadable` | The wallet holds too little, or would not say. |
| `409 rows_taken`, `503 could_not_start` | Another set took some of the rows meanwhile, or the run could not be started. The rows are free again. |

What the sets cost so far is in [the plan](plan.md), under "Slice 2". TinyFish's rate card says $0.10 a row; what the wallet lost has been three to six cents a row, and nothing for a set whose rows had no website.

## Keeping the spend line right

The spend at the foot of every page is the sum of the `spend` table. Sets are booked from the wallet, so those lines are what was paid. Pages are different: Knock books a page beyond its free 800 a day at $0.001 as it reads it, and so far TinyFish has not charged for them. After each of my own lists I read the wallet, and where it did not fall I take those lines out:

```bash
npx wrangler d1 execute knock --remote --command "SELECT kind, COUNT(*), SUM(amount_usd) FROM spend GROUP BY kind"
npx wrangler d1 execute knock --remote --command "DELETE FROM spend WHERE kind = 'reads'"
```

I run the second line only when the wallet's fall equals the sum of the `set` lines. If TinyFish starts charging for those pages, the lines stay.

## When something looks wrong

| What I see | What it means | What I do |
|---|---|---|
| A list says "Today's pages are read. Knock carries on at midnight UTC." | The day's 800 free pages are used, and so are the 6,000 pages Knock may pay for in all. "Knock on one door" is refused until midnight too. | Nothing: it wakes by itself. To see how many paid pages are used: the `limits` table, name `reads`, every day's count past 800. |
| A list has not moved for ten minutes and is not waiting | A run died between two hand-overs. | Press "Carry on" on the list's page, or `POST /api/lists/<id>/carry-on`. It starts where the list stopped and repeats nothing whose answer was saved. It refuses while the list is still moving. |
| A row's door says "could not be asked today" | The call for it failed three times as a whole. | Hand the row in again in a small sheet. |
| Many doors say "answered with an error", "did not answer in time" or "blocks readers" | Those sites turn TinyFish's reader away. | Put them to TinySet: they are in the order Knock picks. |
| A set stays `posted` for more than 40 minutes | The run that looks at it died. | `POST /api/admin/sets/<id>/carry-on`. It never repeats a fill that was already asked for. |
| A set is `failed` | Its note says why, and its rows are free again. | Read the note and the wallet before starting another. |
| `429 daily_limit` on a new list | Three lists were handed in by visitors today. | Wait for midnight UTC, or hand it in with the admin token. |
| The same sheet gives a different verdict on a row the next day | Search listed different pages. | Nothing: the row names the page it rests on. [How it works](https://knock.hamdanesmail12-7a9.workers.dev/how) says so under "What it cannot tell". |

Logs: `npx wrangler tail knock`. A run's steps, tries and times: `npx wrangler workflows instances describe knock-list <run id>`.

## How the runs are named

A list is carried by many Workflow runs, one after another, because the free plan allows one run 50 requests to other hosts and 50 database queries. A run makes at most 18 calls and counts its queries, and hands over before it would pass either.

| Run id | What it carries |
|---|---|
| `<list>-a<attempt>-g<group>-<stage>-<turn>` | One leg of a list: a group of 40 rows in one stage (the doors, the searches, the second knocks, the second searches, the page reads, the verdicts). "Carry on" raises the attempt. |
| `<set>-a<attempt>-t<turn>` | One leg of a set. |

A run's id is fixed by what it carries, so a hand-over that is tried twice starts one run.

## Changing a rule

1. Save the signs of a finished list and run the verdict code over them unchanged. It must give back every row as the live list holds it. If it does not, stop: the copy is wrong, or the live code is not the code in the checkout.
2. Write the failing tests, then change `src/core/verdict.ts`.
3. Run the saved signs through the new rules and write down which rows change.
4. Change the "How it works" page and the design in the same commit.
5. Deploy, with nothing running. `decide-again` on each finished list. Its `changed` must be the number from step 3.
