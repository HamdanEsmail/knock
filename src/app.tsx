// Every route: the pages, the JSON API and my own routes.
import { Hono, type Context } from "hono";
import type { Child } from "hono/jsx";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { BOARD_ROWS, ROWS_MAX } from "./core/limits";
import type { Verdict } from "./core/signs";
import type { Env } from "./env";
import { carryOn } from "./list/carry";
import { createList, type NewList } from "./list/create";
import { countsOf, rowOut, sheetOut } from "./list/csv-out";
import { FIRST_LEG } from "./list/run";
import { deleteList, featuredList, getList, listRows, patchList, totals } from "./list/store";
import { handOver } from "./list/workflow";
import { setsOf } from "./outside/store";
import { carryOnSet, startWave, type WaveAsk } from "./outside/wave";
import { startSetRun } from "./outside/workflow";
import { Layout } from "./site/layout";
import { Home, ListPage, NotFound } from "./site/pages";
import { CARRIED, NOTES } from "./site/words";

type AppContext = Context<{ Bindings: Env }>;

const VERDICTS: readonly Verdict[] = ["alive", "slowing down", "zombie", "could not tell"];
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

/** Rows the API gives in one answer, at most. */
const API_ROWS_MAX = 200;

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  const isAdmin = (c: AppContext): boolean => {
    const given = c.req.header("authorization") ?? "";
    return c.env.ADMIN_TOKEN !== undefined && c.env.ADMIN_TOKEN !== "" && given === `Bearer ${c.env.ADMIN_TOKEN}`;
  };
  const root = (c: AppContext): string => c.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const start = (c: AppContext) => (id: string) => handOver(c.env, id, 0, FIRST_LEG);
  const whole = (v: string | undefined, fallback: number): number => (v !== undefined && /^\d{1,6}$/.test(v) ? Number(v) : fallback);

  async function page(c: AppContext, props: { title: string; description: string; refresh?: number; status?: ContentfulStatusCode }, children: Child) {
    const body = (
      <Layout title={props.title} description={props.description} refresh={props.refresh} totals={await totals(c.env.DB)}>
        {children}
      </Layout>
    );
    return c.html(`<!doctype html>${body}`, props.status ?? 200, {
      "cache-control": "no-store",
      "content-security-policy": CSP,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
  }

  const notFound = (c: AppContext) => page(c, { title: "Nobody at this address · Knock", description: "This address does not lead to a list.", status: 404 }, <NotFound />);

  // ---- The API ----

  app.get("/api/stats", async (c) => c.json(await totals(c.env.DB)));

  app.post("/api/lists", async (c) => {
    let input: NewList;
    if ((c.req.header("content-type") ?? "").includes("json")) {
      let body: Record<string, unknown>;
      try {
        body = (await c.req.json()) as Record<string, unknown>;
      } catch {
        return c.json({ error: "bad_request", message: "Send JSON with the sheet as text in `csv`, or send the CSV itself as text/csv." }, 400);
      }
      input = { csv: body?.csv, title: body?.title, source: body?.source, nameCol: body?.name_col, addressCol: body?.address_col, firstLineIsHeader: body?.first_line_is_header };
    } else {
      input = { csv: await c.req.text(), title: c.req.query("title") };
    }
    const made = await createList(c.env, input, isAdmin(c) ? "mine" : "visitor", new Date(), start(c));
    if (!made.ok) return c.json({ error: made.code, message: made.message }, made.status);
    return c.json({ id: made.id, url: `${root(c)}/l/${made.id}`, api: `${root(c)}/api/lists/${made.id}`, csv: `${root(c)}/api/lists/${made.id}/csv`, rows: made.rows }, 202);
  });

  const missing = (c: AppContext) => c.json({ error: "not_found", message: "There is no list with that id." }, 404);

  app.get("/api/lists/:id", async (c) => {
    const list = await getList(c.env.DB, c.req.param("id"));
    if (!list) return missing(c);
    const counts = countsOf(list.wall);
    return c.json(
      {
        id: list.id,
        title: list.title,
        status: list.status,
        note: list.note,
        rows: list.rowCount,
        decided: list.rowCount - counts.not_yet,
        counts,
        wall: list.wall,
        created_at: list.createdAt,
        moved_at: list.movedAt,
        wake_at: list.wakeAt,
        finished_at: list.finishedAt,
        url: `${root(c)}/l/${list.id}`,
        csv: `${root(c)}/api/lists/${list.id}/csv`,
      },
      200,
      { "cache-control": "no-store" },
    );
  });

  app.get("/api/lists/:id/rows", async (c) => {
    const verdict = c.req.query("verdict");
    if (verdict !== undefined && !VERDICTS.includes(verdict as Verdict)) return c.json({ error: "bad_request", message: "`verdict` is one of: alive, slowing down, zombie, could not tell." }, 400);
    const list = await getList(c.env.DB, c.req.param("id"));
    if (!list) return missing(c);
    const from = whole(c.req.query("from"), 0);
    const count = Math.min(Math.max(whole(c.req.query("count"), 50), 1), API_ROWS_MAX);
    // One more than asked for tells whether there is a next page.
    const rows = await listRows(c.env.DB, list.id, { from, count: count + 1, verdict: verdict as Verdict | undefined });
    const shown = rows.slice(0, count);
    return c.json({ id: list.id, rows: shown.map(rowOut), next: rows.length > count ? (shown.at(-1)?.n ?? from) + 1 : null }, 200, { "cache-control": "no-store" });
  });

  app.get("/api/lists/:id/csv", async (c) => {
    const list = await getList(c.env.DB, c.req.param("id"));
    if (!list) return missing(c);
    const rows = await listRows(c.env.DB, list.id, { from: 0, count: ROWS_MAX });
    return c.body(sheetOut(list, rows), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="knock-${list.id}.csv"`, "cache-control": "no-store" });
  });

  const carry = (c: AppContext, id: string) => carryOn(c.env, id, new Date(), (attempt, leg) => handOver(c.env, id, attempt, leg));

  app.post("/api/lists/:id/carry-on", async (c) => {
    const state = await carry(c, c.req.param("id"));
    if (state === "not found") return missing(c);
    return c.json({ state, message: CARRIED[state] });
  });

  // ---- My own routes ----

  const forbidden = (c: AppContext) => c.json({ error: "forbidden", message: "This route needs the admin token." }, 403);

  app.post("/api/admin/lists/:id/feature", async (c) => {
    if (!isAdmin(c)) return forbidden(c);
    const id = c.req.param("id");
    if (!(await getList(c.env.DB, id))) return missing(c);
    const on = c.req.query("off") !== "1";
    await patchList(c.env.DB, id, { featured: on ? 1 : 0 });
    return c.json({ id, featured: on });
  });

  app.delete("/api/admin/lists/:id", async (c) => {
    if (!isAdmin(c)) return forbidden(c);
    await deleteList(c.env.DB, c.req.param("id"));
    return c.json({ deleted: c.req.param("id") });
  });

  // A set of rows put to TinySet. It is the part that costs money, so only I can start it.
  // With no body it takes the next fifty rows in the order of what TinySet can add; `count`
  // takes fewer, and `rows` takes exactly the rows named.
  app.post("/api/admin/lists/:id/wave", async (c) => {
    if (!isAdmin(c)) return forbidden(c);
    let body: Record<string, unknown> = {};
    try {
      const sent: unknown = await c.req.json();
      if (typeof sent === "object" && sent !== null) body = sent as Record<string, unknown>;
    } catch {
      // no body
    }
    const ask: WaveAsk = {};
    if (Array.isArray(body.rows) && body.rows.every((n) => Number.isInteger(n) && (n as number) >= 0)) ask.rows = body.rows as number[];
    if (typeof body.count === "number" && Number.isFinite(body.count)) ask.count = body.count;
    const started = await startWave(c.env, c.req.param("id"), ask, new Date(), (setId) => startSetRun(c.env, setId, 0, 0));
    if (!started.ok) return c.json({ error: started.code, message: started.message }, started.status as ContentfulStatusCode);
    return c.json({ set: started.setId, rows: started.rows, cost_at_most_usd: started.costAtMost }, 202);
  });

  app.get("/api/admin/lists/:id/sets", async (c) => {
    if (!isAdmin(c)) return forbidden(c);
    return c.json({ sets: await setsOf(c.env.DB, c.req.param("id")) });
  });

  app.post("/api/admin/sets/:id/carry-on", async (c) => {
    if (!isAdmin(c)) return forbidden(c);
    const state = await carryOnSet(c.env, c.req.param("id"), new Date(), (setId, attempt) => startSetRun(c.env, setId, attempt, 0));
    return c.json({ state }, state === "not found" ? 404 : 200);
  });

  // ---- The pages ----

  app.get("/", async (c) => {
    const code = c.req.query("note") ?? "";
    return page(
      c,
      { title: "Knock: still listed, but is anybody home?", description: "Hand in a spreadsheet of companies and get it back with a verdict, a last-seen date and evidence links on every row." },
      <Home note={Object.hasOwn(NOTES, code) ? NOTES[code]! : null} featured={await featuredList(c.env.DB)} />,
    );
  });

  app.post("/lists", async (c) => {
    const fields = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = fields.sheet;
    const pasted = typeof fields.csv === "string" ? fields.csv : "";
    const csv = file instanceof File && file.size > 0 ? await file.text() : pasted;
    const made = await createList(c.env, { csv, title: fields.title }, "visitor", new Date(), start(c));
    return c.redirect(made.ok ? `/l/${made.id}` : `/?note=${made.code}`, 303);
  });

  app.get("/l/:id", async (c) => {
    const list = await getList(c.env.DB, c.req.param("id"));
    if (!list) return notFound(c);
    const asked = c.req.query("verdict") ?? "";
    const verdict = VERDICTS.includes(asked as Verdict) ? (asked as Verdict) : null;
    const from = whole(c.req.query("from"), 0);
    const rows = await listRows(c.env.DB, list.id, { from, count: BOARD_ROWS + 1, verdict: verdict ?? undefined });
    const code = c.req.query("note") ?? "";
    return page(
      c,
      { title: `${list.title} · Knock`, description: `${list.rowCount} companies, each with a verdict and its evidence.`, refresh: list.status === "working" ? 15 : list.status === "waiting" ? 60 : undefined },
      <ListPage list={list} rows={rows} from={from} verdict={verdict} note={Object.hasOwn(NOTES, code) ? NOTES[code]! : null} />,
    );
  });

  app.post("/l/:id/carry-on", async (c) => {
    const id = c.req.param("id");
    const state = await carry(c, id);
    if (state === "not found") return notFound(c);
    return c.redirect(`/l/${id}?note=${encodeURIComponent(state)}`, 303);
  });

  app.notFound((c) => (c.req.path.startsWith("/api/") ? c.json({ error: "not_found", message: "There is no such route." }, 404) : notFound(c)));

  return app;
}
