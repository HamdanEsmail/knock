// The pages, in the look I chose: a board of tiles, the list as a wall of doors, and the rows
// as a departure board. Every figure and every row on them comes from Knock's own results.
import type { Child } from "hono/jsx";
import { showDay } from "../core/dates";
import { BOARD_ROWS, LISTS_PER_DAY, ROWS_MAX } from "../core/limits";
import { doorWords, linkWords, outsideWords, pagesWords } from "../core/sheet";
import { countsOf } from "../list/csv-out";
import type { FullRow, ListRecord, Totals } from "../list/store";
import { Top } from "./layout";
import { Band, Cells, Door, LETTER } from "./parts";
import { showMoment } from "./words";

const n = (v: number): string => v.toLocaleString("en-US");

/** What the wall says in words, for a reader who cannot see it and for the line under it. */
function wallWords(list: ListRecord): string {
  const c = countsOf(list.wall);
  const left = c.not_yet > 0 ? ` ${n(c.not_yet)} are still to be knocked on.` : "";
  return `Knock found someone home at ${n(c.alive)}, the lights dimming at ${n(c.slowing_down)}, nobody home at ${n(c.zombie)}, and could not tell at ${n(c.could_not_tell)}.${left}`;
}

/** Which of the sheet's columns Knock took for the name and the address, so a wrong guess shows at once. */
function columnsTaken(list: ListRecord): string {
  const called = (col: number): string => `"${list.header[col] ?? `column ${col + 1}`}"`;
  const from = list.source === "sheet" ? "From a Google Sheet. " : "";
  return `${from}Names come from the column ${called(list.nameCol)}${list.addressCol === null ? ", and the sheet has no column of addresses" : `, addresses from ${called(list.addressCol)}`}.`;
}

export function Home({ note, featured, sample, totals }: { note: string | null; featured: ListRecord | null; sample: FullRow[]; totals: Totals }) {
  const counts = featured ? countsOf(featured.wall) : null;
  return (
    <>
      <main class="board first">
        <Top />
        <div class="tile name">
          <h1>Knock</h1>
        </div>
        {featured ? (
          <a class="tile wall" href={`/l/${featured.id}`}>
            <Cells wall={featured.wall} lights label={`${n(featured.rowCount)} doors. ${wallWords(featured)}`} />
            <p>
              {featured.title}. One door for each company, by Knock's own check. {wallWords(featured)}
            </p>
          </a>
        ) : (
          <div class="tile wall">
            <Cells wall={".".repeat(374)} label="A wall of doors, none of them knocked on yet" />
            <p>Every row of a list is a door. Each takes its light when Knock has decided: on, dimming or out.</p>
          </div>
        )}
        <section class="tile one">
          <Door light="a" />
          <div>
            <h2>Knock on one door</h2>
            <form class="try" method="post" action="/knock">
              <input type="text" name="address" placeholder="stripe.com" aria-label="A company's web address" autocomplete="off" required />
              <button class="btn ink" type="submit">
                Knock
              </button>
            </form>
            <p>Type a company's address and see what its own pages answer today.</p>
          </div>
        </section>
        <p class="tile say end lead">Hand it a spreadsheet of 500 companies. It comes back with a verdict, a last-seen date and the evidence on every row.</p>
        <div class="tile up end">
          <p>A CSV or a Google Sheet, up to {n(ROWS_MAX)} rows.</p>
          <a class="btn" href="#take">
            Upload a spreadsheet
          </a>
        </div>
      </main>

      {featured && sample.length > 0 ? (
        <section class="list cut" aria-label="Some rows of the example list" data-ui>
          {sample.map((row) => (
            <Band listId={featured.id} row={row} />
          ))}
        </section>
      ) : null}

      <section class="board how">
        <h2>Three ways to tell if anyone is home</h2>
        <div class="stage s1">
          <div class="tile warm" data-ui>
            <div class="sign">
              <span class="k">The door</span>
              <span>42technologies.com answers</span>
              <span>airmada.com is for sale</span>
              <span>auro.ai is nearly empty</span>
            </div>
          </div>
          <h3>Knock</h3>
          <p>It opens the company's address today and writes down what answers: a page, a forward to another site, a for-sale sign, or nothing at all.</p>
        </div>
        <div class="stage s2">
          <div class="tile" data-ui>
            <div class="sign">
              <span class="k">New pages on partnerstack.com</span>
              <span>The home page answers</span>
              <span>Search lists 10 dated pages in the last 12 months</span>
              <span>The newest is dated 4 Jun 2026</span>
              <span class="hit">Knock read that page today</span>
              <span>Verdict: alive, last seen 4 Jun 2026</span>
            </div>
          </div>
          <h3>Look for something new</h3>
          <p>TinyFish Search lists the pages on that site dated in the last year, then the last three. Knock reads the newest itself, and the jobs and sign-up pages the home page links to.</p>
        </div>
        <div class="stage s3">
          <div class="tile dark" data-ui>
            <div class="sign">
              <span class="k">What others say about Rdio</span>
              <span>Still operates: no</span>
              <span>What happened: shut down, its assets bought by Pandora</span>
              <span>When: 16 Nov 2015</span>
              <span>Source: variety.com, "Rdio to Shut Down on December 22"</span>
              <span class="hit">Knock read the source itself, and it names Rdio</span>
              <span>Latest activity found: 22 Dec 2015</span>
              <span>Verdict: zombie, by what TinySet found</span>
            </div>
          </div>
          <h3>Ask around</h3>
          <p>A dead site cannot say what happened to it. For those rows TinySet finds whether the company was bought, renamed or shut down, with a source. Knock reads every source before it counts.</p>
        </div>
      </section>

      {featured && counts ? (
        <section class="board figures" aria-label="The example list in figures">
          <div class="tile dark figure wide">
            <b>{n(featured.rowCount)}</b>
            <p>doors knocked on in the example: {featured.title.replace(/[.:]\s.*$/, "")}.</p>
          </div>
          <div class="tile navy figure">
            <b>{n(counts.zombie)}</b>
            <p>still on the list, with nobody home.</p>
          </div>
          <div class="tile warm figure">
            <b>${totals.spend_usd.toFixed(2)}</b>
            <p>spent at TinyFish, on every list Knock has checked.</p>
          </div>
        </section>
      ) : null}

      <section class="board take" id="take">
        <div class="tile navy flank"></div>
        <form class="form" method="post" action="/lists" enctype="multipart/form-data">
          <h2>Hand in a spreadsheet</h2>
          {note ? (
            <p class="note" role="alert">
              {note}
            </p>
          ) : null}
          <div class="pair">
            <label>
              A CSV file
              <input type="file" name="sheet" accept=".csv,text/csv,text/plain" />
            </label>
            <label>
              A name for the list, if you like
              <input type="text" name="title" maxlength={120} />
            </label>
          </div>
          <label>
            Or the link of a Google Sheet that anyone with the link can view
            <input type="url" name="sheet_url" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" />
          </label>
          <label>
            Or paste the sheet here
            <textarea name="csv" placeholder={"Company,Website\nStripe,stripe.com\nParse,parse.com"}></textarea>
          </label>
          <button class="btn ink" type="submit">
            Knock on every door
          </button>
          <p class="small">
            One company on each line, with its name and, where you have it, its web address. Up to {n(ROWS_MAX)} rows. Knock takes {LISTS_PER_DAY} new lists a day, and your sheet
            comes back with your own columns untouched.
          </p>
        </form>
        <div class="tile dark flank">
          <Cells wall={featured ? featured.wall.slice(0, 120) : ".".repeat(120)} label="Some doors of the wall" />
        </div>
      </section>
    </>
  );
}

function Standing({ list }: { list: ListRecord }) {
  const counts = countsOf(list.wall);
  const decided = list.rowCount - counts.not_yet;
  const progress = `${n(decided)} of ${n(list.rowCount)} rows decided`;
  if (list.status === "done") {
    return (
      <p class="now" role="status">
        Finished{list.finishedAt ? ` ${showMoment(list.finishedAt)}` : ""}. {progress}.
      </p>
    );
  }
  if (list.status === "waiting") {
    return (
      <>
        <p class="now" role="status">
          <span class="pulse" aria-hidden="true"></span>
          {list.note}
        </p>
        <p>
          {list.wakeAt ? `It carries on at ${showMoment(list.wakeAt)}. ` : ""}
          {progress}.
        </p>
      </>
    );
  }
  return (
    <>
      <p class="now" role="status">
        <span class="pulse" aria-hidden="true"></span>
        {list.note !== "" ? list.note : "The check has started."}
      </p>
      <p>{progress}. This page reloads by itself every 15 seconds, and each door takes its light as its row is finished.</p>
    </>
  );
}

export function ListPage({ list, rows, from, verdict, note }: { list: ListRecord; rows: FullRow[]; from: number; verdict: string | null; note: string | null }) {
  const counts = countsOf(list.wall);
  const filter = verdict ? `&verdict=${encodeURIComponent(verdict)}` : "";
  const more = rows.length > BOARD_ROWS;
  const shown = rows.slice(0, BOARD_ROWS);
  const kinds: [string, string, number][] = [
    ["alive", "a", counts.alive],
    ["slowing down", "s", counts.slowing_down],
    ["zombie", "z", counts.zombie],
    ["could not tell", "u", counts.could_not_tell],
  ];
  return (
    <>
      <main class="board">
        <Top />
        <div class="tile title">
          <h1>{list.title}</h1>
          <p>
            {n(list.rowCount)} {list.rowCount === 1 ? "company" : "companies"}, one door each. {wallWords(list)}
          </p>
          <p class="small">{columnsTaken(list)}</p>
        </div>
        <div class={`tile status ${list.status === "done" ? "warm" : "navy"}`}>
          {note ? (
            <p class="note" role="alert">
              {note}
            </p>
          ) : null}
          <Standing list={list} />
          <div class="acts">
            <a class="btn" href={`/api/lists/${list.id}/csv`}>
              Download the sheet
            </a>
            {list.status === "done" ? null : (
              <form method="post" action={`/l/${list.id}/carry-on`}>
                <button class="btn paper" type="submit">
                  Carry on
                </button>
              </form>
            )}
          </div>
          {list.status === "done" ? null : <p class="small">"Carry on" starts the check again where it stopped. It does nothing unless the list has stood still for ten minutes.</p>}
        </div>
        <div class="tile dark bigwall">
          <Cells wall={list.wall} label={`${n(list.rowCount)} doors. ${wallWords(list)}`} />
        </div>
        <ul class="counts">
          <li>
            <a href={`/l/${list.id}`} aria-current={verdict === null ? "true" : undefined}>
              <b>{n(list.rowCount)}</b>
              <span>all rows</span>
            </a>
          </li>
          {kinds.map(([word, letter, count]) => (
            <li>
              <a href={`/l/${list.id}?verdict=${encodeURIComponent(word)}`} aria-current={verdict === word ? "true" : undefined}>
                <b>{n(count)}</b>
                <span>
                  <i class={letter}></i>
                  {word}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </main>

      {shown.length === 0 ? (
        <div class="board">
          <p class="tile prose">No rows to show here yet.</p>
        </div>
      ) : (
        <section class="list whole" aria-label="The rows">
          {shown.map((row) => (
            <Band listId={list.id} row={row} />
          ))}
        </section>
      )}
      {from > 0 || more ? (
        <nav class="board" aria-label="More rows">
          <div class="pager">
            {from > 0 ? (
              <a class="btn ink" href={`/l/${list.id}?from=${Math.max(from - BOARD_ROWS, 0)}${filter}`}>
                Earlier rows
              </a>
            ) : (
              <span></span>
            )}
            {more ? (
              <a class="btn ink" href={`/l/${list.id}?from=${(shown.at(-1)?.n ?? from) + 1}${filter}`}>
                Later rows
              </a>
            ) : null}
          </div>
        </nav>
      ) : null}
    </>
  );
}

/** A link shown as its address without the scheme, cut where it gets long. */
function Link({ href }: { href: string }) {
  const text = href.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <a href={href} rel="noopener nofollow">
      {text.length > 70 ? `${text.slice(0, 67)}…` : text}
    </a>
  );
}

/** A door with its verdict and every sign behind it. `where` says where the row comes from. */
function Result({ row, where, outside }: { row: FullRow; where: Child; outside: boolean }) {
  const letter = row.verdict ? (LETTER[row.verdict] ?? "u") : ".";
  const reads = row.reads ?? [];
  const read = (kind: "jobs" | "signup") => reads.find((r) => r.kind === kind);
  return (
    <main class="board">
      <Top />
      <div class="tile door">
        <Door light={letter} />
      </div>
      <div class="tile verdict">
        <h1>{row.name}</h1>
        <span class={`block ${letter === "." ? "" : letter}`.trim()}>{row.verdict ?? "not knocked on yet"}</span>
        <p class="lead">{row.why ?? "Knock has not reached this row yet."}</p>
        <p>
          {row.lastSeen ? `Last seen ${showDay(row.lastSeen)}${row.lastSeenFrom ? ` (${row.lastSeenFrom})` : ""}. ` : row.verdict ? "No dated sign was found. " : ""}
          {row.checkedOn ? `Checked on ${showDay(row.checkedOn)}. ` : ""}
          {where}
        </p>
      </div>
      <dl class="signs">
        <div>
          <dt>The door</dt>
          <dd>{row.address === null ? "No address was given for this row." : `Its address ${doorWords(row.door)}.`}</dd>
          {row.address ? (
            <dd>
              <Link href={row.address} />
            </dd>
          ) : null}
        </div>
        <div>
          <dt>New pages on its site</dt>
          <dd>{pagesWords(row.pages, reads, row.address !== null)}</dd>
        </div>
        <div>
          <dt>Jobs and sign-up pages</dt>
          <dd>Jobs page: {linkWords(row.door?.jobsLink ?? null, read("jobs"))}</dd>
          <dd>Sign-up page: {linkWords(row.door?.signupLink ?? null, read("signup"))}</dd>
        </div>
        <div class="wide">
          <dt>What others say, found by TinySet</dt>
          <dd>{!outside ? "TinySet is asked only for rows of a list. A single door gets the free signs." : row.outside === null ? "TinySet was not asked about this row." : `${outsideWords(row.outside, reads)}.`}</dd>
        </div>
        <div>
          <dt>The evidence</dt>
          {row.evidence.length === 0 ? (
            <dd>No link was read for this row.</dd>
          ) : (
            <dd>
              <ol>
                {row.evidence.map((href) => (
                  <li>
                    <Link href={href} />
                  </li>
                ))}
              </ol>
            </dd>
          )}
        </div>
      </dl>
    </main>
  );
}

export function RowPage({ list, row }: { list: ListRecord; row: FullRow }) {
  return (
    <Result
      row={row}
      outside
      where={
        <>
          Row {n(row.n + 1)} of <a href={`/l/${list.id}`}>{list.title}</a>.
        </>
      }
    />
  );
}

/** What one door answered. Nothing of it is kept. */
export function OneDoorPage({ row, searchBusy }: { row: FullRow; searchBusy: boolean }) {
  return (
    <Result
      row={row}
      outside={false}
      where={
        <>
          {searchBusy ? "Search was taken up this minute, so only the door itself was asked: knock again in a minute for its dated pages. " : ""}
          Knocked on just now; nothing of it is kept. <a href="/">Knock on another door.</a>
        </>
      }
    />
  );
}

/** A refusal for one door, with the door's light out. */
export function OneDoorRefused({ message }: { message: string }) {
  return (
    <main class="board">
      <Top />
      <div class="tile door">
        <Door light="." />
      </div>
      <div class="tile verdict">
        <h1>Nobody knocked.</h1>
        <p class="lead">{message}</p>
        <a class="btn" href="/">
          Back to the first page
        </a>
      </div>
    </main>
  );
}

export function NotFound() {
  return (
    <main class="board">
      <Top />
      <div class="tile door">
        <Door light="z" />
      </div>
      <div class="tile verdict">
        <h1>Nobody at this address.</h1>
        <p class="lead">This address does not lead to a list or to one of its rows.</p>
        <a class="btn" href="/">
          Go to the first page
        </a>
      </div>
    </main>
  );
}
