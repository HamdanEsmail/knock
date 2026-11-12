// The frame every page stands in: the head, the name, and the foot with the totals and my name.
import type { Child } from "hono/jsx";
import type { Totals } from "../list/store";

const CSS = `
:root{--ink:#1f2b4d;--paper:#fff;--line:#d9dde8;--soft:#f4f5f9;--accent:#f7941d;--mute:#5a6480}
*{box-sizing:border-box}
html{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper);line-height:1.5}
body{margin:0}
a{color:inherit}
.wrap{max-width:960px;margin:0 auto;padding:0 20px}
header.top{border-bottom:2px solid var(--ink)}
header.top .wrap{display:flex;align-items:baseline;justify-content:space-between;padding-top:16px;padding-bottom:12px}
header.top a.name{font-weight:800;font-size:22px;text-decoration:none;letter-spacing:-.01em}
main{padding:28px 0 48px}
h1{font-size:clamp(30px,6vw,52px);line-height:1.05;letter-spacing:-.02em;margin:0 0 12px}
h2{font-size:20px;margin:36px 0 10px}
p{margin:0 0 12px}
.lede{font-size:19px;max-width:44em}
.note{border:2px solid var(--accent);padding:10px 14px;font-weight:600;max-width:44em}
form.take{border:2px solid var(--ink);padding:18px;display:grid;gap:14px;max-width:44em;margin-top:20px}
label{display:grid;gap:6px;font-weight:600;font-size:15px}
input[type=text],textarea{font:inherit;padding:10px;border:1px solid var(--ink);width:100%;background:var(--paper);color:var(--ink)}
textarea{min-height:120px;font-family:ui-monospace,Consolas,monospace;font-size:14px}
button,.btn{font:inherit;font-weight:700;background:var(--ink);color:var(--paper);border:2px solid var(--ink);padding:10px 18px;cursor:pointer;text-decoration:none;display:inline-block}
button.plain,.btn.plain{background:var(--paper);color:var(--ink)}
button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.hint{color:var(--mute);font-size:14px;font-weight:400}
.now{display:flex;gap:10px;align-items:center;font-weight:600;font-size:17px}
.dot{width:12px;height:12px;border-radius:50%;background:var(--accent);flex:none;animation:beat 1.2s ease-in-out infinite}
@keyframes beat{0%,100%{transform:scale(.6);opacity:.5}50%{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion:reduce){.dot{animation:none}}
.counts{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0;padding:0;list-style:none}
.counts li{border:1px solid var(--line);padding:8px 12px;min-width:120px}
.counts b{display:block;font-size:26px;line-height:1.1}
.wall{display:flex;flex-wrap:wrap;gap:2px;margin:14px 0}
.wall i{width:12px;height:16px;background:var(--soft);border:1px solid var(--line)}
.wall i.a{background:var(--accent);border-color:var(--accent)}
.wall i.s{background:#f9cf9a;border-color:#f9cf9a}
.wall i.z{background:var(--ink);border-color:var(--ink)}
.wall i.u{background:#aab1c6;border-color:#aab1c6}
.acts{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
.acts form{margin:0}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:13px;text-transform:none;color:var(--mute);font-weight:600}
td.v{font-weight:700;white-space:nowrap}
td.why{min-width:240px}
td a{word-break:break-all}
footer.foot{border-top:2px solid var(--ink);padding:16px 0 28px;font-size:14px;color:var(--mute)}
footer.foot .wrap{display:flex;flex-wrap:wrap;gap:8px 24px;justify-content:space-between}
`;

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
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <header class="top">
          <div class="wrap">
            <a class="name" href="/">
              Knock
            </a>
            <span class="hint">Is anybody home?</span>
          </div>
        </header>
        <div class="wrap">{props.children}</div>
        <footer class="foot">
          <div class="wrap">
            <span>
              {t.lists} {t.lists === 1 ? "list" : "lists"} · {t.rows} rows decided · TinyFish spend ${t.spend_usd.toFixed(2)}
            </span>
            <span>
              Built by{" "}
              <a href="https://github.com/HamdanEsmail" rel="author">
                Hamdan Esmail
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
