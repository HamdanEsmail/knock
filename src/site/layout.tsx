// The frame every page stands in. The look is a board of tiles (family/knock/direction-notes.md):
// a top row that is itself tiles, the page's own tiles, and a foot built from doors.
import type { Child } from "hono/jsx";
import type { Totals } from "../list/store";
import { Mark } from "./parts";

const FONTS = "https://fonts.googleapis.com/css2?family=Stack+Sans+Headline:wght@300&family=Stack+Sans+Text:wght@400;500&display=swap";
/** Changed whenever the stylesheet changes, so a browser never shows a new page in old clothes. */
const STYLES = "/assets/board.css?v=1";

export const AUTHOR_URL = "https://github.com/HamdanEsmail";

export function Layout(props: { title: string; description: string; refresh?: number; totals: Totals; children?: Child }) {
  const t = props.totals;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{props.title}</title>
        <meta name="description" content={props.description} />
        <meta name="author" content="Hamdan Esmail" />
        {props.refresh ? <meta http-equiv="refresh" content={String(props.refresh)} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
        <link href={FONTS} rel="stylesheet" />
        <link rel="stylesheet" href={STYLES} />
      </head>
      <body>
        <a class="skip" href="#content">
          Skip to the content
        </a>
        <div id="content">{props.children}</div>
        <footer class="board foot">
          <a class="mark-large" href="/" aria-label="Knock: the first page">
            <span aria-hidden="true">Knock</span>
          </a>
          <div class="tile navy">
            <span>
              {t.lists} {t.lists === 1 ? "list" : "lists"} · {t.decided} rows decided · TinyFish spend ${t.spend_usd.toFixed(2)}
            </span>
            <a href="/how">How it works</a>
          </div>
          <div class="tile">
            <span>
              Built by{" "}
              <a href={AUTHOR_URL} rel="author">
                Hamdan Esmail
              </a>
            </span>
            <a href="/how#api">The API</a>
          </div>
        </footer>
      </body>
    </html>
  );
}

/** The top row of every board: the mark, the links, and the one action. */
export function Top({ here }: { here?: "check" | "how" }) {
  return (
    <header class="top">
      <a class="mark" href="/" aria-label="Knock: the first page">
        <Mark />
      </a>
      <nav class="links" aria-label="Pages">
        <a href="/#take">Check a list</a>
        <a href="/example">The example</a>
        <a href="/how" aria-current={here === "how" ? "page" : undefined}>
          How it works
        </a>
        <a class="wide" href="/how#api">
          API
        </a>
      </nav>
      <a class="act" href="/#take">
        Upload a spreadsheet
      </a>
    </header>
  );
}
