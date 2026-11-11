import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/core/csv";

describe("reading a sheet", () => {
  it("reads plain rows", () => {
    expect(parseCsv("name,website\nStripe,stripe.com\nRdio,rdio.com\n")).toEqual([
      ["name", "website"],
      ["Stripe", "stripe.com"],
      ["Rdio", "rdio.com"],
    ]);
  });

  it("reads quotes, doubled quotes, and commas and line breaks inside a cell", () => {
    const text = 'name,note\n"Acme, Inc.","said ""hello""\nthen left"\n';
    expect(parseCsv(text)).toEqual([
      ["name", "note"],
      ["Acme, Inc.", 'said "hello"\nthen left'],
    ]);
  });

  it("reads a sheet saved by Excel: a byte-order mark and CRLF line ends", () => {
    expect(parseCsv("﻿name,website\r\nStripe,stripe.com\r\n")).toEqual([
      ["name", "website"],
      ["Stripe", "stripe.com"],
    ]);
  });

  it("finds semicolons and tabs between cells from the first line", () => {
    expect(parseCsv("name;website\nAcme, Inc.;acme.com\n")).toEqual([
      ["name", "website"],
      ["Acme, Inc.", "acme.com"],
    ]);
    expect(parseCsv("name\twebsite\nStripe\tstripe.com\n")).toEqual([
      ["name", "website"],
      ["Stripe", "stripe.com"],
    ]);
  });

  it("drops empty lines and keeps a last line without a line end", () => {
    expect(parseCsv("name\n\nStripe\n  \n,,\nRdio")).toEqual([["name"], ["Stripe"], ["Rdio"]]);
  });

  it("keeps cells in other scripts and with accents as they are", () => {
    expect(parseCsv("name,website\nCafé Müller,cafe.de\n滴滴出行,didiglobal.com\n")).toEqual([
      ["name", "website"],
      ["Café Müller", "cafe.de"],
      ["滴滴出行", "didiglobal.com"],
    ]);
  });

  it("reads nothing from an empty text", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("﻿\r\n\r\n")).toEqual([]);
  });
});

describe("writing a sheet", () => {
  it("quotes only the cells that need it and ends lines with CRLF", () => {
    expect(toCsv([["name", "note"], ["Acme, Inc.", 'said "hello"'], ["Rdio", "two\nlines"], ["Path", " padded "]])).toBe(
      'name,note\r\n"Acme, Inc.","said ""hello"""\r\nRdio,"two\nlines"\r\nPath," padded "\r\n',
    );
  });

  it("gives back what it was given", () => {
    const rows = [
      ["name", "website", "note"],
      ["Acme, Inc.", "acme.com", 'a "quoted" word'],
      ["Café Müller", "", "line one\r\nline two"],
      ["", "x.io", ";semi;colons;"],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
