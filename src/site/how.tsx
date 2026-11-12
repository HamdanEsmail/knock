// How it works, and the API. Everything here describes what the code does today: the signs,
// the rules in their order, where TinySet comes in, what it costs and what it cannot tell.
import { ALIVE_MONTHS, FREE_READS_PER_DAY, KNOCKS_PER_VISITOR_PER_HOUR, LISTS_PER_DAY, READS_USD_MAX, READ_USD, ROWS_MAX, SEARCHES_PER_MINUTE, SET_ROWS, SET_ROW_USD, ZOMBIE_MONTHS } from "../core/limits";
import { KNOCK_HEADER } from "../core/sheet";
import type { Totals } from "../list/store";
import { Top } from "./layout";

export function HowPage({ base, totals }: { base: string; totals: Totals }) {
  return (
    <main class="board">
      <Top here="how" />
      <div class="tile title">
        <h1>How Knock tells who is home</h1>
        <p>Six signs for every row, read from live pages on the day of the check, and nine rules that turn them into a verdict.</p>
      </div>
      <p class="tile status warm lead end">Nothing is taken from memory. A verdict rests only on pages Knock read that day, and every date says where it comes from.</p>

      <article class="prose">
        <h2>The six signs</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">The sign</th>
              <th scope="col">What Knock does</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>The door</td>
              <td>
                Reads the company's address with TinyFish Fetch. It answers, forwards to another site (which names the company or does not), is for sale, is nearly empty, no longer
                exists, answers with an error, does not answer in time, or blocks readers. A door that failed is knocked on a second time.
              </td>
            </tr>
            <tr>
              <td>New pages</td>
              <td>
                Asks TinyFish Search for dated pages on the company's own site: first in the last {ALIVE_MONTHS} months, then {ALIVE_MONTHS} to {ZOMBIE_MONTHS} months ago, then older.
              </td>
            </tr>
            <tr>
              <td>The page's own date</td>
              <td>Reads the newest page Search listed. When that page states its own date, that date is used and not the index's. A page that cannot stand for the site sends Knock to the next one.</td>
            </tr>
            <tr>
              <td>A jobs page</td>
              <td>Follows the link from the home page and reads it.</td>
            </tr>
            <tr>
              <td>A sign-up page</td>
              <td>Follows the link from the home page and reads it.</td>
            </tr>
            <tr>
              <td>What others say</td>
              <td>Asks TinySet, for the rows whose own site cannot say: whether the company still operates, what happened to it and when, with a source, and its latest public activity with a link.</td>
            </tr>
          </tbody>
        </table>

        <h2>The nine rules</h2>
        <p>The first rule that fits decides, so the same signs always give the same verdict, and every row names the rule's reason in one sentence.</p>
        <ol>
          <li>TinySet found that the company no longer operates, and Knock read the source: zombie.</li>
          <li>The address is for sale: zombie.</li>
          <li>The address no longer exists, and nothing says the company operates under another: zombie.</li>
          <li>The address forwards to a site that does not name the company, and nothing says it still operates: zombie.</li>
          <li>A dated sign from the last {ALIVE_MONTHS} months: alive.</li>
          <li>
            The newest dated sign is {ALIVE_MONTHS} to {ZOMBIE_MONTHS} months old; or nothing is dated, but the door answers and a jobs or sign-up page is there; or a source read today says it operates: slowing down.
          </li>
          <li>The newest dated sign is more than {ZOMBIE_MONTHS} months old: zombie.</li>
          <li>The home page is nearly empty and nothing else was found: zombie.</li>
          <li>Anything else: could not tell, with the reason.</li>
        </ol>
        <p>
          Rules 3, 4, 7 and 8 rest on what the company's own address shows. When TinySet says the company still operates but gave no source Knock could read and that names it, Knock does not
          call the company a zombie on those signs alone: the row says could not tell, and gives both facts.
        </p>

        <h2>Where TinySet comes in</h2>
        <p>
          A site that is gone, for sale or silent cannot say what happened to the company. Those rows go to TinySet, {SET_ROWS} to a set. TinySet finds its own rows, so the list is written into the
          dataset's description and the company's name is the set's key. That is what made it keep to a list when I tested it.
        </p>
        <ul>
          <li>A row that comes back under a name that is not on the list, or on another website than the one sent, is thrown away.</li>
          <li>
            A cell that holds two names, as "Kenota (formerly ExVivo Labs)", is found by either on a page. From TinySet the name inside the brackets counts only when the site that was
            sent comes back with it.
          </li>
          <li>Every source link is read by Knock itself, and counts only when the page could be read and names the company.</li>
          <li>
            A renamed company's new site does not carry its old name. A new page on the site its old address now leads to counts all the same, once a source that names the old name was read.
            Without such a source it does not, because an address that someone else took over would look the same.
          </li>
          <li>The day a company that still runs was renamed or bought counts as a day it was seen.</li>
          <li>Rows that did not come back get one more fill. After that the row says "TinySet returned nothing".</li>
          <li>A set is asked for once. The wallet is read before and after it, and its fall is what the set is booked at.</li>
          <li>On the example list, a source on Y Combinator's own site is shown and decides nothing, because that record is what Knock is scored against.</li>
        </ul>

        <h2>What it costs</h2>
        <ul>
          <li>
            Reading a page is free at TinyFish up to 1,000 pages a day. Knock keeps to {FREE_READS_PER_DAY.toLocaleString("en-US")}, and may pay ${READ_USD} a page after that, up to ${READS_USD_MAX} in all.
            It books those pages at that price as it reads them, and I settle the figure against the wallet after each of my own lists, so the spend shown is what was paid.
          </li>
          <li>Search is free. Knock asks at most {SEARCHES_PER_MINUTE} a minute, so a long list takes hours and not minutes.</li>
          <li>TinySet costs ${SET_ROW_USD.toFixed(2)} for each row that comes back.</li>
          <li>
            So far Knock has checked {totals.decided.toLocaleString("en-US")} rows in {totals.lists} {totals.lists === 1 ? "list" : "lists"} and spent ${totals.spend_usd.toFixed(2)} at TinyFish.
          </li>
        </ul>

        <h2>What it cannot tell</h2>
        <ul>
          <li>A running company whose site carries no date anywhere comes out as slowing down.</li>
          <li>A date from the search index is the day a page was first published. A page that is kept up to date can look older than it is.</li>
          <li>A verdict that rests on one search can change from one day to the next, because the index does.</li>
          <li>An address that someone else has taken over and filled with new pages can look alive. TinySet's part is what catches it.</li>
          <li>A company whose name is an everyday word is named by any page that uses the word.</li>
        </ul>

        <h2>The sheet that comes back</h2>
        <p>Your own columns, untouched and in their order, then {KNOCK_HEADER.length} of Knock's:</p>
        <p>
          <code>{KNOCK_HEADER.join(", ")}</code>
        </p>

        <h2 id="api">The API</h2>
        <p>
          Hand in a sheet of up to {ROWS_MAX.toLocaleString("en-US")} rows. Knock takes {LISTS_PER_DAY} lists a day from visitors, and answers {KNOCKS_PER_VISITOR_PER_HOUR} single doors an hour for each.
        </p>
        <pre>
          <code>{`curl -X POST ${base}/api/lists?title=My+list \\
  -H "content-type: text/csv" --data-binary @companies.csv

curl ${base}/api/lists/LIST_ID
curl "${base}/api/lists/LIST_ID/rows?from=0&count=200&verdict=zombie"
curl ${base}/api/lists/LIST_ID/csv -o checked.csv
curl -X POST ${base}/api/lists/LIST_ID/carry-on

curl -X POST ${base}/api/knock \\
  -H "content-type: application/json" -d '{"address":"stripe.com"}'

curl ${base}/api/stats`}</code>
        </pre>
      </article>

      <aside class="aside">
        <div class="tile navy">
          <p class="lead">Alive: seen doing something in the last {ALIVE_MONTHS} months.</p>
        </div>
        <div class="tile warm">
          <p class="lead">
            Slowing down: last seen {ALIVE_MONTHS} to {ZOMBIE_MONTHS} months ago, or open with nothing dated.
          </p>
        </div>
        <div class="tile dark">
          <p class="lead">Zombie: still listed, and nobody home.</p>
        </div>
        <a class="btn" href="/#take">
          Upload a spreadsheet
        </a>
      </aside>
    </main>
  );
}
