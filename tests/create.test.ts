import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createList } from "../src/list/create";
import { countOf, getList, listRows, loadGroup } from "../src/list/store";

const NOW = new Date("2026-11-12T08:00:00.000Z");
const DAY = "2026-11-12";

let started: string[] = [];
const start = async (id: string) => {
  started.push(id);
};

const make = (csv: unknown, more: Record<string, unknown> = {}, owner: "visitor" | "mine" = "mine") => createList(env, { csv, ...more }, owner, NOW, start);

async function made(csv: unknown, more: Record<string, unknown> = {}, owner: "visitor" | "mine" = "mine"): Promise<string> {
  const result = await make(csv, more, owner);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result.id;
}

const counts = async () => ({
  lists: await env.DB.prepare("SELECT COUNT(*) AS n FROM lists").first("n"),
  rows: await env.DB.prepare("SELECT COUNT(*) AS n FROM rows").first("n"),
});

beforeEach(async () => {
  started = [];
  for (const table of ["rows", "lists", "limits", "spend"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});

describe("taking a sheet in", () => {
  it("reads a sheet saved by Excel: a byte-order mark, CRLF and semicolons", async () => {
    const id = await made("﻿Company;Website;Founded\r\nStripe;stripe.com;2010\r\nParse;https://parse.com/;2011\r\n");
    expect(id).toMatch(/^[a-z0-9]{10}$/);
    expect(started).toEqual([id]);
    expect(await getList(env.DB, id)).toMatchObject({ header: ["Company", "Website", "Founded"], nameCol: 0, addressCol: 1, rowCount: 2, status: "working", owner: "mine", source: "csv", title: "A list of 2 companies" });
    const rows = await listRows(env.DB, id, { from: 0, count: 10 });
    expect(rows.map((r) => [r.name, r.address])).toEqual([
      ["Stripe", "https://stripe.com/"],
      ["Parse", "https://parse.com/"],
    ]);
    expect(rows[0]?.cells).toEqual(["Stripe", "stripe.com", "2010"]);
  });

  it("takes addresses written loosely, and marks what is no address", async () => {
    const id = await made(["name,site", "A,stripe.com", "B,WWW.Stripe.com/", "C,http://stripe.com/about", "D,hello@stripe.com", "E,n/a", "F,-", "G,"].join("\n"));
    const rows = await loadGroup(env.DB, id, 0);
    expect(rows.map((r) => r.address)).toEqual(["https://stripe.com/", "https://www.stripe.com/", "http://stripe.com/about", null, null, null, null]);
    expect(rows.slice(3).map((r) => r.door?.kind)).toEqual(["no_address", "no_address", "no_address", "no_address"]);
    expect(rows.slice(0, 3).map((r) => r.door)).toEqual([null, null, null]);
  });

  it("takes a sheet of names only", async () => {
    const id = await made("Company\nStripe\nParse\n");
    expect(await getList(env.DB, id)).toMatchObject({ header: ["Company"], nameCol: 0, addressCol: null, rowCount: 2 });
    expect((await loadGroup(env.DB, id, 0)).map((r) => [r.name, r.address, r.door?.kind])).toEqual([
      ["Stripe", null, "no_address"],
      ["Parse", null, "no_address"],
    ]);
  });

  it("keeps the first line as a row when the sheet has no header, and names the columns itself", async () => {
    const id = await made("Stripe,stripe.com\nParse,parse.com\n");
    expect(await getList(env.DB, id)).toMatchObject({ header: ["column_1", "column_2"], nameCol: 0, addressCol: 1, rowCount: 2 });
    expect((await loadGroup(env.DB, id, 0)).map((r) => r.name)).toEqual(["Stripe", "Parse"]);

    // Names only and no header: a first line that is not a header word is a company.
    const names = await made("Stripe\nParse\nRdio\n");
    expect(await getList(env.DB, names)).toMatchObject({ header: ["column_1"], rowCount: 3 });
    // The caller can say which it is.
    const told = await made("Portfolio\nStripe\nParse\n", { firstLineIsHeader: true });
    expect(await getList(env.DB, told)).toMatchObject({ header: ["Portfolio"], rowCount: 2 });
  });

  it("keeps the same company twice as two rows", async () => {
    const id = await made("name,url\nStripe,stripe.com\nStripe,stripe.com\n");
    expect((await loadGroup(env.DB, id, 0)).map((r) => r.address)).toEqual(["https://stripe.com/", "https://stripe.com/"]);
  });

  it("returns names and cells in other scripts exactly as they came", async () => {
    const id = await made("name,url,note\nZürcher Café,zuercher.example,été\n株式会社メルカリ,mercari.com,東京\nشركة كريم,careem.com,دبي\n");
    const rows = await listRows(env.DB, id, { from: 0, count: 10 });
    expect(rows.map((r) => r.name)).toEqual(["Zürcher Café", "株式会社メルカリ", "شركة كريم"]);
    expect(rows[1]?.cells).toEqual(["株式会社メルカリ", "mercari.com", "東京"]);
    expect(rows[2]?.cells).toEqual(["شركة كريم", "careem.com", "دبي"]);
  });

  it("uses a row's address as its name when the name cell is empty, and cuts a very long name", async () => {
    const id = await made(`name,url\n,stripe.com\n${"x".repeat(300)},parse.com\n`);
    const rows = await loadGroup(env.DB, id, 0);
    expect(rows[0]?.name).toBe("stripe.com");
    expect(rows[1]?.name).toHaveLength(120);
  });

  it("takes the columns the caller chose, and refuses one that is not there", async () => {
    const id = await made("a,b,c\nhttps://x.com,Acme,acme.com\n", { nameCol: 1, addressCol: 2, firstLineIsHeader: true });
    expect(await getList(env.DB, id)).toMatchObject({ nameCol: 1, addressCol: 2 });
    expect((await loadGroup(env.DB, id, 0))[0]).toMatchObject({ name: "Acme", address: "https://acme.com/" });

    const bad = await make("a,b\nAcme,acme.com\n", { nameCol: 7 });
    expect(bad).toMatchObject({ ok: false, status: 400, code: "bad_column" });
  });

  it("takes a title, cut to a line", async () => {
    const id = await made("name,url\nStripe,stripe.com\n", { title: `  Y Combinator, 2014 to 2016 ${"z".repeat(300)}` });
    const title = (await getList(env.DB, id))?.title ?? "";
    expect(title.startsWith("Y Combinator, 2014 to 2016")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(120);
  });
});

describe("a sheet that is refused", () => {
  const refused = async (csv: unknown, code: string, status: number, words: RegExp) => {
    const result = await make(csv, {}, "visitor");
    expect(result).toMatchObject({ ok: false, code, status });
    if (!result.ok) expect(result.message).toMatch(words);
    expect(await counts()).toEqual({ lists: 0, rows: 0 });
    // A sheet that was refused has not used one of the day's three.
    expect(await countOf(env.DB, DAY, "lists")).toBe(0);
    expect(started).toEqual([]);
  };

  it("says why: nothing in it", async () => {
    await refused("", "empty_sheet", 400, /empty/);
    await refused("  \r\n \n", "empty_sheet", 400, /empty/);
    await refused(undefined, "empty_sheet", 400, /empty/);
    await refused(42, "empty_sheet", 400, /empty/);
  });

  it("says why: a first line and nothing under it", async () => {
    await refused("Company,Website\n", "header_only", 400, /no rows/);
  });

  it("says why: more than 1,000 rows", async () => {
    const csv = `name,url\n${Array.from({ length: 1001 }, (_, i) => `C${i},c${i}.com`).join("\n")}`;
    await refused(csv, "too_many_rows", 400, /1,001 rows.*1,000/);
  });

  it("says why: too large, before reading it", async () => {
    await refused(`name,url\nA,${"a".repeat(600_001)}.com\n`, "sheet_too_large", 413, /600,000/);
  });

  it("says why: too many columns", async () => {
    await refused(`${Array.from({ length: 61 }, (_, i) => `c${i}`).join(",")}\n${Array.from({ length: 61 }, () => "x").join(",")}\n`, "too_many_columns", 400, /61 columns.*60/);
  });
});

describe("how many lists a day", () => {
  const csv = "name,url\nStripe,stripe.com\n";

  it("takes three from visitors and refuses the fourth; mine are not counted", async () => {
    for (let i = 0; i < 3; i++) expect((await make(csv, {}, "visitor")).ok).toBe(true);
    const fourth = await make(csv, {}, "visitor");
    expect(fourth).toMatchObject({ ok: false, status: 429, code: "daily_limit" });
    if (!fourth.ok) expect(fourth.message).toMatch(/midnight UTC/);
    expect(await counts()).toEqual({ lists: 3, rows: 3 });
    expect((await make(csv, {}, "mine")).ok).toBe(true);
    expect(await countOf(env.DB, DAY, "lists")).toBe(3);
  });

  it("keeps nothing and gives the day's slot back when the check cannot be started", async () => {
    const result = await createList(env, { csv }, "visitor", NOW, async () => {
      throw new Error("no run");
    });
    expect(result).toMatchObject({ ok: false, status: 503, code: "could_not_start" });
    expect(await counts()).toEqual({ lists: 0, rows: 0 });
    expect(await countOf(env.DB, DAY, "lists")).toBe(0);
  });
});
