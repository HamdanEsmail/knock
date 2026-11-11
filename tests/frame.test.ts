import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const app = createApp();
const call = (path: string, init?: RequestInit) => app.request(`https://knock.test${path}`, init, env);

describe("the frame", () => {
  it("has its tables", async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
    const names = results.map((r) => r.name);
    for (const table of ["limits", "lists", "rows", "spend"]) expect(names).toContain(table);
  });

  it("answers the stats with nothing in them yet", async () => {
    const res = await call("/api/stats");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lists: 0, rows: 0, alive: 0, slowing_down: 0, zombie: 0, could_not_tell: 0, spend_usd: 0 });
  });

  it("answers an unknown path with 404", async () => {
    expect((await call("/api/nothing-here")).status).toBe(404);
  });
});
