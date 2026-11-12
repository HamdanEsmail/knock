// The plain pages: the first page, which takes a sheet, and a list's page, which shows how far
// its check has got. They say what is so and nothing more; the board comes in a later slice.
import { showDay } from "../core/dates";
import { BOARD_ROWS, LISTS_PER_DAY, ROWS_MAX } from "../core/limits";
import { countsOf } from "../list/csv-out";
import type { FullRow, ListRecord } from "../list/store";
import { VERDICT_WORDS, showMoment } from "./words";

export function Home({ note, featured }: { note: string | null; featured: ListRecord | null }) {
  return (
    <main>
      <h1>Still listed. Is anybody home?</h1>
      <p class="lede">
        Hand Knock a spreadsheet of companies. It knocks on every door, and hands the same sheet back with a verdict on each row, the date the company was last seen, and
        links to the evidence.
      </p>
      {note ? (
        <p class="note" role="alert">
          {note}
        </p>
      ) : null}
      <form class="take" method="post" action="/lists" enctype="multipart/form-data">
        <label>
          A CSV file
          <input type="file" name="sheet" accept=".csv,text/csv,text/plain" />
        </label>
        <label>
          Or paste the sheet here
          <textarea name="csv" placeholder={"Company,Website\nStripe,stripe.com\nParse,parse.com"}></textarea>
        </label>
        <label>
          A name for the list <span class="hint">(optional)</span>
          <input type="text" name="title" maxlength={120} />
        </label>
        <div>
          <button type="submit">Knock on every door</button>
        </div>
        <p class="hint">
          One company on each line, with its name and, where you have it, its web address. Up to {ROWS_MAX.toLocaleString("en-US")} rows. Knock takes {LISTS_PER_DAY} new
          lists a day.
        </p>
      </form>
      {featured ? (
        <>
          <h2>A list Knock has checked</h2>
          <p>
            <a href={`/l/${featured.id}`}>{featured.title}</a>: {featured.rowCount.toLocaleString("en-US")} rows.
          </p>
        </>
      ) : null}
    </main>
  );
}

function Standing({ list }: { list: ListRecord }) {
  const counts = countsOf(list.wall);
  const decided = list.rowCount - counts.not_yet;
  const progress = `${decided.toLocaleString("en-US")} of ${list.rowCount.toLocaleString("en-US")} rows decided`;
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
          <span class="dot" aria-hidden="true"></span>
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
        <span class="dot" aria-hidden="true"></span>
        {list.note !== "" ? list.note : "The check has started."}
      </p>
      <p>{progress}. This page reloads by itself every 15 seconds.</p>
    </>
  );
}

export function ListPage({ list, rows, from, verdict, note }: { list: ListRecord; rows: FullRow[]; from: number; verdict: string | null; note: string | null }) {
  const counts = countsOf(list.wall);
  const filter = verdict ? `&verdict=${encodeURIComponent(verdict)}` : "";
  const more = rows.length > BOARD_ROWS;
  const shown = rows.slice(0, BOARD_ROWS);
  return (
    <main>
      <h1>{list.title}</h1>
      {note ? (
        <p class="note" role="alert">
          {note}
        </p>
      ) : null}
      <Standing list={list} />

      <ul class="counts">
        <li>
          <b>{counts.alive}</b>alive
        </li>
        <li>
          <b>{counts.slowing_down}</b>slowing down
        </li>
        <li>
          <b>{counts.zombie}</b>zombie
        </li>
        <li>
          <b>{counts.could_not_tell}</b>could not tell
        </li>
        <li>
          <b>{counts.not_yet}</b>not yet knocked on
        </li>
      </ul>
      <div class="wall" role="img" aria-label={`${list.rowCount} doors: ${counts.alive} alive, ${counts.slowing_down} slowing down, ${counts.zombie} zombie, ${counts.could_not_tell} could not tell, ${counts.not_yet} not yet knocked on`}>
        {[...list.wall].map((c) => (
          <i class={c === "." ? "" : c}></i>
        ))}
      </div>

      <div class="acts">
        <a class="btn" href={`/api/lists/${list.id}/csv`}>
          Download the sheet
        </a>
        {list.status === "done" ? null : (
          <form method="post" action={`/l/${list.id}/carry-on`}>
            <button class="plain" type="submit">
              Carry on
            </button>
          </form>
        )}
      </div>
      {list.status === "done" ? null : <p class="hint">"Carry on" starts the check again where it stopped. It does nothing unless the list has stood still for ten minutes.</p>}

      <h2>The rows</h2>
      <p>
        <a href={`/l/${list.id}`}>All</a> · <a href={`/l/${list.id}?verdict=alive`}>Alive</a> · <a href={`/l/${list.id}?verdict=slowing+down`}>Slowing down</a> ·{" "}
        <a href={`/l/${list.id}?verdict=zombie`}>Zombie</a> · <a href={`/l/${list.id}?verdict=could+not+tell`}>Could not tell</a>
      </p>
      {shown.length === 0 ? (
        <p>No rows to show here yet.</p>
      ) : (
        <div class="scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Row</th>
                <th scope="col">Company</th>
                <th scope="col">Verdict</th>
                <th scope="col">Last seen</th>
                <th scope="col">Why</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr>
                  <td>{r.n + 1}</td>
                  <td>{r.name}</td>
                  <td class="v">{r.verdict ? VERDICT_WORDS[r.verdict] : "…"}</td>
                  <td>{r.lastSeen ? showDay(r.lastSeen) : ""}</td>
                  <td class="why">{r.why ?? ""}</td>
                  <td>
                    {r.evidence[0] ? (
                      <a href={r.evidence[0]} rel="noopener nofollow">
                        {r.evidence[0].replace(/^https?:\/\//, "").slice(0, 60)}
                      </a>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p class="acts">
        {from > 0 ? (
          <a class="btn plain" href={`/l/${list.id}?from=${Math.max(from - BOARD_ROWS, 0)}${filter}`}>
            Earlier rows
          </a>
        ) : null}
        {more ? (
          <a class="btn plain" href={`/l/${list.id}?from=${(shown.at(-1)?.n ?? from) + 1}${filter}`}>
            Later rows
          </a>
        ) : null}
      </p>
    </main>
  );
}

export function NotFound() {
  return (
    <main>
      <h1>Nobody at this address.</h1>
      <p class="lede">
        This address does not lead to a list. <a href="/">Go to the first page.</a>
      </p>
    </main>
  );
}
