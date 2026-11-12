import { describe, expect, it } from "vitest";
import { hostNames, nameKey, nameParts, namesCompany } from "../src/core/names";

describe("a company's name", () => {
  it("has a key of its letters and digits", () => {
    expect(nameKey("Yik Yak")).toBe("yikyak");
    expect(nameKey("  Acme, Inc. ")).toBe("acme");
    expect(nameKey("Café Müller GmbH")).toBe("cafemuller");
    expect(nameKey("42")).toBe("42");
    expect(nameKey("滴滴出行")).toBe("滴滴出行");
    expect(nameKey("The Athletic")).toBe("theathletic");
  });

  it("is found in a text as whole words", () => {
    expect(namesCompany("Welcome to The Athletic, part of The New York Times.", "The Athletic")).toBe(true);
    expect(namesCompany("YikYak is back.", "Yik Yak")).toBe(true);
    expect(namesCompany("Yik-Yak, the anonymous app", "Yik Yak")).toBe(true);
    expect(namesCompany("ACME INC. builds anvils", "Acme, Inc.")).toBe(true);
    expect(namesCompany("Visit Café Müller today", "Cafe Muller")).toBe(true);
    expect(namesCompany("滴滴出行 是一家公司", "滴滴出行")).toBe(true);
  });

  it("is not found inside another word", () => {
    expect(namesCompany("A pathway to better health", "Path")).toBe(false);
    expect(namesCompany("Quorum is the workspace for public affairs", "GovPredict")).toBe(false);
    expect(namesCompany("", "Stripe")).toBe(false);
    expect(namesCompany("anything", "")).toBe(false);
  });

  it("is found in a host", () => {
    expect(hostNames("theathletic.com", "The Athletic")).toBe(true);
    expect(hostNames("www.yik-yak.com", "Yik Yak")).toBe(true);
    expect(hostNames("quorum.us", "GovPredict")).toBe(false);
    // Too short to mean anything inside a host.
    expect(hostNames("x42y.com", "42")).toBe(false);
  });
});

describe("a name with a part in brackets", () => {
  // The eight such names among the 590 of the example list, each with its two parts, and
  // whether the part in brackets is a name a page may go by: a word leads it in, or it
  // carries the first name inside it.
  const REAL: [string, string, string, boolean][] = [
    ["Shape (ShapeScale)", "Shape", "ShapeScale", true],
    ["Flirtey (SkyDrop)", "Flirtey", "SkyDrop", false],
    ["VINEBOX (Usual Beverage Co.)", "VINEBOX", "Usual Beverage Co.", false],
    ["Luciq (formerly Instabug)", "Luciq", "Instabug", true],
    ["Sanitation and Health Rights in India (SHRI)", "Sanitation and Health Rights in India", "SHRI", false],
    ["NuCypher (aka Threshold Network)", "NuCypher", "Threshold Network", true],
    ["Kenota (formerly ExVivo Labs)", "Kenota", "ExVivo Labs", true],
    ["UtilityScore (formerly Pando)", "UtilityScore", "Pando", true],
  ];

  it("has the name outside the brackets and the other name inside them, without the word that leads it in", () => {
    for (const [name, main, alias] of REAL) expect(nameParts(name), name).toEqual({ main, alias });
    expect(nameParts("Stripe")).toEqual({ main: "Stripe", alias: null });
    expect(nameParts("Acme (UK) Ltd")).toEqual({ main: "Acme Ltd", alias: "UK" });
    expect(nameParts("Acme (formerly known as Zed Labs)")).toEqual({ main: "Acme", alias: "Zed Labs" });
    // Nothing outside the brackets: the name is taken as it is written.
    expect(nameParts("(Acme)")).toEqual({ main: "(Acme)", alias: null });
  });

  it("is named by a text that carries the name outside the brackets, and by the one inside them when that is a name", () => {
    for (const [name, main, alias, aliasNames] of REAL) {
      expect(namesCompany(`Welcome to ${main}, where things are made.`, name), `${name} by ${main}`).toBe(true);
      expect(namesCompany(`The team behind ${alias} wrote this.`, name), `${name} by ${alias}`).toBe(aliasNames);
      expect(namesCompany("A page about something else entirely.", name), name).toBe(false);
    }
    // The page that showed the fault: the company's own site, which says only the short name.
    expect(namesCompany("Kenota Health | Rapid allergy testing at the point of care", "Kenota (formerly ExVivo Labs)")).toBe(true);
  });

  it("is not named by a part inside another word, and a bracketed part of fewer than four characters says too little", () => {
    expect(namesCompany("Reshape your routine", "Shape (ShapeScale)")).toBe(false);
    expect(namesCompany("We ship to the UK and beyond", "Acme (UK) Ltd")).toBe(false);
    expect(namesCompany("Acme builds anvils", "Acme (UK) Ltd")).toBe(true);
  });

  it("is not named by a part in brackets that is no name: a place, a state, a batch, a kind of company", () => {
    // A sheet's cell often carries a note in brackets. A page that holds the note says nothing about the company.
    expect(namesCompany("Our offices are in London and Paris", "Foo (London)")).toBe(false);
    expect(namesCompany("The startup was acquired in 2019", "Foo (acquired)")).toBe(false);
    expect(namesCompany("Companies of the YC W15 batch", "Foo (YC W15)")).toBe(false);
    expect(namesCompany("A GmbH is a German kind of company", "Foo (GmbH)")).toBe(false);
    expect(hostNames("london.gov.uk", "Foo (London)")).toBe(false);
    expect(hostNames("acquired.fm", "Foo (acquired)")).toBe(false);
    expect(hostNames("skydrop.com", "Flirtey (SkyDrop)")).toBe(false);
    // The name outside the brackets still names it.
    expect(namesCompany("Foo builds anvils in London", "Foo (London)")).toBe(true);
    expect(namesCompany("Foo was acquired in 2019", "Foo (acquired)")).toBe(true);
  });

  it("is named by the part in brackets when that part carries the first name inside it", () => {
    expect(namesCompany("ShapeScale: a 3D body scanner for the home", "Shape (ShapeScale)")).toBe(true);
    expect(hostNames("shapescale.com", "Shape (ShapeScale)")).toBe(true);
  });

  it("is named by an everyday word when that word is its name, as a company called Shape would be", () => {
    expect(namesCompany("A new shape for the fitness market", "Shape (ShapeScale)")).toBe(true);
    expect(namesCompany("A new shape for the fitness market", "Shape")).toBe(true);
  });

  it("is found in a host by either part", () => {
    expect(hostNames("kenota.com", "Kenota (formerly ExVivo Labs)")).toBe(true);
    expect(hostNames("threshold.network", "NuCypher (aka Threshold Network)")).toBe(true);
    expect(hostNames("getvinebox.com", "VINEBOX (Usual Beverage Co.)")).toBe(true);
    expect(hostNames("ottimate.com", "Kenota (formerly ExVivo Labs)")).toBe(false);
    // Too short to mean anything inside a host, as for a whole name.
    expect(hostNames("ukmail.com", "Acme (UK) Ltd")).toBe(false);
  });

  it("keeps the key of the whole name, which is what tells two rows apart", () => {
    expect(nameKey("Kenota (formerly ExVivo Labs)")).toBe("kenotaformerlyexvivolabs");
  });
});
