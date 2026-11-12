import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import type { Env } from "../src/env";
import { exportUrl, readSheetLink } from "../src/list/sheet-link";
import { getList } from "../src/list/store";
import { fetchMock } from "./helpers/fetch-mock";

const ID = "1AbC_dEfGhIjKlMnOpQrStUvWxYz0123456789-_xyz";
const EXPORT = `https://docs.google.com/spreadsheets/d/${ID}/export?format=csv`;
const SHEET = "Company,Website\nStripe,stripe.com\nParse,parse.com\n";
const csv = (body: string) => ({ status: 200, body, headers: { "content-type": "text/csv; charset=utf-8" } });

const app = createApp();
const testEnv = (): Env => ({ ...env, LIST_WORKFLOW: { create: async () => ({}), get: async () => ({}) } }) as unknown as Env;

beforeEach(async () => {
  fetchMock.activate();
  for (const table of ["rows", "lists", "limits", "spend", "sets"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});
afterEach(() => fetchMock.reset());

describe("a Google Sheet, by its link", () => {
  it("finds the sheet's own CSV address in the link people copy, and keeps the tab they were on", () => {
    expect(exportUrl(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`)).toBe(EXPORT);
    expect(exportUrl(`  https://docs.google.com/spreadsheets/d/${ID}/edit#gid=1840221  `)).toBe(`${EXPORT}&gid=1840221`);
    expect(exportUrl(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(EXPORT);
  });

  it("takes nothing that is not a Google Sheet's link", () => {
    for (const link of ["", "stripe.com", "https://example.com/spreadsheets/d/abc", `http://docs.google.com/spreadsheets/d/${ID}/edit`, `https://docs.google.com.evil.example/spreadsheets/d/${ID}/edit`, "https://docs.google.com/document/d/abc/edit"]) {
      expect(exportUrl(link), link).toBeNull();
    }
  });

  it("reads the sheet as CSV", async () => {
    fetchMock.intercept({ method: "GET", url: EXPORT, reply: csv(SHEET) });
    expect(await readSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toEqual({ ok: true, csv: SHEET });
  });

  it("says the sheet is not shared when Google answers with a page and not with the sheet", async () => {
    fetchMock.intercept({ method: "GET", url: EXPORT, reply: { status: 200, body: "<html>Sign in</html>", headers: { "content-type": "text/html" } } });
    expect(await readSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toMatchObject({ ok: false, status: 400, code: "sheet_not_shared" });
    fetchMock.intercept({ method: "GET", url: EXPORT, reply: { status: 404, body: "no" } });
    expect(await readSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toMatchObject({ ok: false, code: "sheet_not_shared" });
    expect(await readSheetLink("https://example.com/sheet")).toMatchObject({ ok: false, status: 400, code: "bad_sheet_link" });
  });

  it("says so when Google cannot be reached", async () => {
    fetchMock.intercept({
      method: "GET",
      url: EXPORT,
      reply: () => {
        throw new TypeError("connection lost");
      },
    });
    expect(await readSheetLink(`https://docs.google.com/spreadsheets/d/${ID}/edit`)).toMatchObject({ ok: false, status: 502, code: "sheet_not_read" });
  });

  it("is taken by the API, and the list remembers it came from a sheet", async () => {
    fetchMock.intercept({ method: "GET", url: EXPORT, reply: csv(SHEET) });
    const res = await app.request("https://knock.test/api/lists", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sheet_url: `https://docs.google.com/spreadsheets/d/${ID}/edit`, title: "From a sheet" }) }, testEnv());
    expect(res.status).toBe(202);
    const { id } = (await res.json()) as { id: string };
    expect(await getList(env.DB, id)).toMatchObject({ title: "From a sheet", source: "sheet", rowCount: 2 });
  });

  it("is taken by the form, and a sheet that is not shared comes back to the form with the reason", async () => {
    fetchMock.intercept({ method: "GET", url: EXPORT, reply: csv(SHEET) });
    const form = (link: string) => app.request("https://knock.test/lists", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `csv=&title=&sheet_url=${encodeURIComponent(link)}` }, testEnv());
    const made = await form(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(made.status).toBe(303);
    expect(made.headers.get("location")).toMatch(/^\/l\/[a-z0-9]{10}$/);
    fetchMock.intercept({ method: "GET", url: EXPORT, reply: { status: 200, body: "<html>Sign in</html>", headers: { "content-type": "text/html" } } });
    const refused = await form(`https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(refused.headers.get("location")).toBe("/?note=sheet_not_shared#take");
    const page = await (await app.request("https://knock.test/?note=sheet_not_shared", {}, testEnv())).text();
    expect(page).toContain("anyone with the link can view");
    expect(page).toContain('name="sheet_url"');
  });
});
