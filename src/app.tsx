// Every route: the pages, the JSON API and the admin routes.
import { Hono } from "hono";
import type { Env } from "./env";
import { totals } from "./list/store";

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/stats", async (c) => c.json(await totals(c.env.DB)));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  return app;
}
