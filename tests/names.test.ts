import { describe, expect, it } from "vitest";
import { hostNames, nameKey, namesCompany } from "../src/core/names";

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
