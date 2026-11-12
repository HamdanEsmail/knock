# Build log

## 11 November 2026: a hundred addresses before any code

Before I planned anything I ran free calls against TinyFish to learn what a dead company looks like from outside. The scripts are in my working folder outside this repository; what they showed is in the [design](specs/2026-11-11-knock-design.md) and at the top of the [plan](plan.md).

What shaped the build:

- **"The address no longer exists" is a real answer.** Fetch said `invalid_url` for 14 of 100 addresses. I asked DNS about each: none of the 14 resolves, and every other kind of failure (an error, a time-out, a blocked reader, an empty page) does. So that answer on a well-formed address means the name is gone.
- **Search gives dates.** Asked for the pages of one site, it lists them with the day each was published. That is a sign of life that needs no guessing.
- **TinySet finds its own rows.** It is built to discover a table, not to fill in mine. What made it keep to a list was writing the list into the dataset's description and making the company's name the key. I made an empty dataset with 50 names that way: the description was stored as I sent it, and the wallet did not move.
- **Cloudflare's free plan allows one Workflow run 50 requests to other hosts and 50 database queries.** A list of several hundred rows needs many times that. So the work had to be cut into short legs from the start.

## 11 November: the core, each part from a failing test

The parts with no network came first: reading a sheet (a file saved by Excel, semicolons, tabs, a header or none), finding the name and address columns, cleaning an address, what a door answered, the dated pages Search lists, the nine rules, and the thirteen columns that go back.

The verdict is one function. It takes the signs of a row and the day, and gives the verdict, the rule that decided, the date last seen and where it comes from, one sentence, and the links. The same signs always give the same answer. That became the most useful property of the whole build: a finished list can be decided again from what it holds, without asking anything twice.

## 12 November: legs

A list is worked 40 rows at a time, each group through every stage before the next begins. Each stage is carried by short Workflow runs that hand over to one another. A run counts its calls and its database queries and hands over before it would pass a limit: at most 18 calls, at most 40 queries.

Three rules I held to:

- **A failed call is not a sign.** A search that was refused never becomes "nothing new". A Fetch call that failed as a whole never becomes an answer for its rows.
- **One bad address costs one row.** A row whose call failed is asked alone the next time.
- **Many rows are written by one statement.** With 50 queries a run, one statement a row was never possible.

"Carry on" raises a list's attempt number. A run's id is built from the list, the attempt, the group, the stage and the turn, so a hand-over tried twice starts one run, and a run from an older attempt stops at its next step.

## 12 November: 46 real rows on my machine

Before any deploy I ran 46 real companies through the whole pipeline locally, with free calls only. All got a verdict. It showed what the free signs can and cannot do:

- A date from Search alone carried most "alive" verdicts, and it once made a dead company alive on the strength of a privacy page.
- A dead company whose site still loads was caught 5 times out of 11. That is the gap TinySet is for.
- A large company's newest listed page forwarded to its status site, and the row came out "slowing down". Now the next listed page is read when the newest cannot stand for the site.

## 12 November: live, with spending at zero

The first deploy had the spending cap at 0, so nothing paid could happen. The same 46 rows, on the real platform: a verdict on every row in 16 minutes, 9 runs, 199 steps, none tried twice, and no run made more than 18 calls.

I stopped a second list by hand in the middle of its searches. "Carry on" refused for ten minutes, because the list had just moved, then started it where it stopped. The second attempt repeated no knock and no search whose answer had been saved.

Two things the live run corrected:

- TinyFish's own record showed 142 pages where Knock had counted 126. The other 16 were pages TinyFish tried and could not read. Knock counts those now.
- Four of the 46 verdicts differed from my machine two hours earlier, because Search listed different pages. Nothing broke: a verdict that rests on one search can change from one day to the next. "How it works" says so.

## 12 November: the 590

Every company of Y Combinator's six batches from 2014 to 2016, 590 rows, names and addresses only. All had a verdict after 2 hours 57 minutes: 86 runs, 2,301 steps, 1,329 calls to TinyFish, no step tried twice, no run failed. The search pace held at seven a minute throughout.

It cost nothing. Knock had booked $0.64 for pages beyond its free 800 a day. The wallet had not moved, so I took that out of the books. Since then I settle the spend line against the wallet after each of my own runs.

Then I set Knock's verdicts beside Y Combinator's own record, which Knock never reads. With the free signs alone, 158 rows said "could not tell": 58 had no address at all and 76 turned the reader away. Of the companies the record calls gone, Knock called 73 zombie and could not tell for 96.

## 12 November: 2.2 million rows read

The same run showed a fault of mine. Every save walked all the rows of its list, and every page view counted every row in the database. The database read 2.2 million rows that day, 44% of what the free plan allows all my projects together. A save now goes straight to its rows, and the totals at the foot of a page are read from each list's wall, which is one short string. A test checks the query plan.

## 12 November: TinySet, and a step that must never run twice

TinySet is the one part that costs money, so I built it around the charge:

- The rows are claimed and the empty dataset's id is saved before any fill is asked for.
- The fill is asked for in a step that is never tried a second time. A fill that is lost costs nothing; one made twice costs double. The step takes its right in the database first and reads the dataset before it asks.
- The wallet is read before the set and ten minutes after its last fill ended. The set is booked at the wallet's fall, never at more than its rows at the rate card.
- One set runs at a time, so each one's cost can be read from the wallet.
- A set runs only on the day its list was read, because its rows are decided again and their sentences say "read today".

What comes back is not trusted. A row under a name that is not on the list, or on another website than the one sent, is thrown away. Every source link is read by Knock itself and counts only when the page could be read and names the company. A source on Y Combinator's own site is shown and decides nothing, because that record is what Knock is scored against.

## 12 November: the gate

I wrote the pass rule before any row came back: none from outside the list, and at least 35 of 50 with a source Knock could read. First two rows, to prove every step on the real platform: $0.10, which is what the wallet fell by. Then the other 48.

It passed: 41 of 50 usable, none from outside the list, $2.80 for fifty rows where the rate card says $5. Eighteen of the fifty verdicts changed, most from "could not tell" to zombie with a source.

Two more sets followed the same day. The 50 rows with no address cost nothing at all: the wallet had not moved ten minutes after the set ended, nor seventeen. I do not know the rule behind that. Fifty mixed rows cost $2.90.

## 12 November: the board

The pages got the look I chose: a board of flat tiles, white, navy and one orange. A list's first screen is a wall with one small door for every row, lit, dim or out. Under it the rows stand as on a departure board, and every row has its own page with the signs behind its verdict. The first page takes a sheet three ways (a file, a Google Sheet's link, pasted text) and answers a single address on the spot.

## 12 November: tuning the rules, and saying so

Seventeen companies the record calls running were still zombie. I looked at why, and changed three rules:

- When TinySet says a company operates but gave no source Knock could read, Knock no longer calls it a zombie on its own address's signs alone. It says "could not tell", with both facts.
- A renamed company's new site does not carry its old name. A new page on the site the old address now leads to counts, once a source that names the old name was read. Without such a source it does not, because an address someone else took over looks the same.
- The day a company that still runs was renamed or bought counts as a day it was seen.

How I kept it honest:

1. I saved the signs of all 590 live rows and ran the unchanged rules over them. They gave back every row as the live list held it: 0 of 590 different.
2. I wrote the failing tests, then the change. On the saved signs it moved 13 rows and no others.
3. After the deploy, deciding the live list again reported 13 changed, then 0.

Two other changes I measured and left alone, because neither separated the living from the dead.

These rules were changed after I had seen the record. The score on this list is therefore a score on the list they were tuned on, and not a test of them.

## 12 November: one more set, and a name in brackets

A last set of fifty: every nearly empty home page that had not been asked about, and 18 of the 45 dead addresses, picked by a rule I wrote down before looking at any name. I also wrote down how I would read it: the hard line is "no row from outside the list".

By the letter, that line was crossed once. "Kenota" came back for the row I had sent as "Kenota (formerly ExVivo Labs)", and Knock threw it away as a name that is not on the list. No other company came back, but my own check prints FAIL for the set, and it should: the row was lost to a fault of mine that I had already seen once and left.

So I fixed it. A cell with a part in brackets is now found by the name outside them. From TinySet the name inside the brackets counts only when the site that was sent comes back with it, and a short name that two rows share leads to neither. I broke both guards on purpose and saw their tests fail.

My first version of the fix was too loose, and a review caught it before any deploy: it took whatever stood in the brackets as a second name, so a cell like "Foo (London)" would have been named by any page that says "London". The eight real names I had tested with all held true second names, so they could not show it. Now the part in brackets counts on a page only when a word such as "formerly" leads it in, or when it carries the first name inside it.

What the set showed otherwise: 49 of 50 back, $1.60 where the rate card says $5, and 16 companies that were zombie on an empty page or a dead address are now zombie on a shutdown or a purchase with a source. For a dead company TinySet often says "no longer operates" and gives nothing to read: 18 rows came back with no link at all. Those rows keep the verdict the free signs gave them.

Five sets, 200 rows, $7.30. The wallet lost exactly that.

## 12 November: before the judges

Three last things, each found by checking what I was about to hand in.

- I handed a small sheet in on the live site the way a stranger would, as a file through the form. It came back right, and a company written with its old name in brackets, at its old address, was recognised on the site that address now leads to.
- The pages Knock may pay for were 2,000 in all, and one day's work on the 590 had used 866 of them. Two long sheets from judges on the same day would have left the second one waiting until midnight. The allowance is now 6,000 pages. Nothing has been charged for any of them.
- My own "How it works" page said that addresses for sale go to TinySet. They never did. I had written the sentence from memory of the design and not from the code that picks the rows.
