import { describe, expect, it } from "vitest";
import { guessColumns, hasHeader } from "../src/core/columns";

describe("finding the name and the address columns", () => {
  it("goes by the header's words", () => {
    expect(guessColumns(["Company", "Website"], [["Stripe", "stripe.com"]])).toEqual({ name: 0, address: 1 });
    expect(guessColumns(["id", "Startup name", "URL", "batch"], [["1", "Stripe", "https://stripe.com", "S09"]])).toEqual({ name: 1, address: 2 });
    expect(guessColumns(["Domain", "Organisation"], [["stripe.com", "Stripe"]])).toEqual({ name: 1, address: 0 });
    expect(guessColumns(["Account Name", "Owner", "Company URL"], [["Stripe", "Dana", "stripe.com"]])).toEqual({ name: 0, address: 2 });
  });

  it("goes by what the cells hold when the header does not say", () => {
    const sample = [
      ["1", "Stripe", "payments", "stripe.com"],
      ["2", "Rdio", "music", "http://rdio.com"],
      ["3", "Tarsnap", "backups", "n/a"],
    ];
    expect(guessColumns(["a", "b", "c", "d"], sample)).toEqual({ name: 1, address: 3 });
  });

  it("does not take a column of emails or of LinkedIn pages for the address when there is a website", () => {
    const header = ["Name", "Contact", "LinkedIn", "Site"];
    const sample = [["Stripe", "hello@stripe.com", "https://linkedin.com/company/stripe", "stripe.com"]];
    expect(guessColumns(header, sample)).toEqual({ name: 0, address: 3 });
  });

  it("takes a sheet of names only", () => {
    expect(guessColumns(["Company"], [["Stripe"], ["Rdio"]])).toEqual({ name: 0, address: null });
    expect(guessColumns(["Company", "Sector"], [["Stripe", "Payments"], ["Rdio", "Music"]])).toEqual({ name: 0, address: null });
  });

  it("takes the first column for the name when nothing else says", () => {
    expect(guessColumns(["x", "y"], [["Stripe", "Payments"]])).toEqual({ name: 0, address: null });
  });
});

describe("whether the first line is a header", () => {
  it("is one when it holds words", () => {
    expect(hasHeader(["Company", "Website"])).toBe(true);
    expect(hasHeader(["name"])).toBe(true);
  });

  it("is not one when it already holds an address", () => {
    expect(hasHeader(["Stripe", "stripe.com"])).toBe(false);
    expect(hasHeader(["Stripe", "https://stripe.com"])).toBe(false);
  });
});
