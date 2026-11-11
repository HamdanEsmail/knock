import { describe, expect, it } from "vitest";
import { findLink, readDoor } from "../src/core/door";
import type { PageRead } from "../src/core/signs";
import saved from "./fixtures/doors.json";

// Real answers from 100 company home pages read on 11 November 2026, cut short.
const cases = saved as { name: string; address: string; read: PageRead }[];
const door = (name: string, knocks = 1) => {
  const c = cases.find((x) => x.name === name);
  if (!c) throw new Error(`no saved door for ${name}`);
  return readDoor(c.read, c.name, c.address, knocks);
};
const page = (over: Partial<Extract<PageRead, { ok: true }>>): PageRead => ({
  url: "https://acme.com/",
  ok: true,
  finalUrl: "https://acme.com/",
  title: "Acme",
  pageDate: null,
  serverDate: null,
  text: "Acme makes anvils. ".repeat(60),
  chars: 1140,
  links: [],
  ...over,
});

describe("what a door says", () => {
  it("answers, with its jobs and sign-up links", () => {
    const d = door("Algolia");
    expect(d.kind).toBe("answers");
    expect(d.asked).toBe("http://www.algolia.com");
    expect(d.finalUrl).toBe("https://www.algolia.com/");
    expect(d.jobsLink).toBe("https://www.algolia.com/careers");
    expect(d.signupLink).toBe("https://dashboard.algolia.com/users/sign_up");
    expect(d.knocks).toBe(1);
  });

  it("answers without a jobs page", () => {
    const d = door("42");
    expect(d.kind).toBe("answers");
    expect(d.jobsLink).toBeNull();
    expect(d.signupLink).toBe("https://www.42technologies.com/pricing");
    expect(d.serverDate).toBe("2026-11-11");
  });

  it("forwards to a site that names the company", () => {
    expect(door("Protonet")).toMatchObject({ kind: "forwards", toHost: "protonet.com", namesIt: true });
    expect(door("The Athletic")).toMatchObject({ kind: "forwards", toHost: "nytimes.com", namesIt: true, finalUrl: "https://www.nytimes.com/athletic/" });
    expect(door("MineralSoft")).toMatchObject({ kind: "forwards", toHost: "enverus.com", namesIt: true });
  });

  it("forwards to a site that does not name it, and takes none of that site's links", () => {
    expect(door("GovPredict")).toMatchObject({ kind: "forwards", toHost: "quorum.us", namesIt: false, jobsLink: null, signupLink: null });
    expect(door("Liftigniter")).toMatchObject({ kind: "forwards", toHost: "paradium.ai", namesIt: false });
  });

  it("is for sale, even though the seller's page names it", () => {
    expect(door("Airmada")).toMatchObject({ kind: "for_sale", toHost: "atom.com" });
    expect(readDoor(page({ text: "This domain is for sale. Make an offer today.", chars: 45 }), "Acme", "https://acme.com/").kind).toBe("for_sale");
    expect(readDoor(page({ finalUrl: "https://www.hugedomains.com/domain_profile.cfm?d=acme.com" }), "Acme", "https://acme.com/").kind).toBe("for_sale");
  });

  it("is nearly empty", () => {
    expect(door("Camperoo").kind).toBe("nearly_empty");
    expect(door("Auro Robotics").kind).toBe("nearly_empty");
    expect(door("Willing").kind).toBe("nearly_empty");
    expect(door("Real Artists")).toMatchObject({ kind: "nearly_empty", error: "empty_content" });
  });

  it("says what went wrong when the page could not be read", () => {
    expect(door("Assembly")).toMatchObject({ kind: "gone", error: "invalid_url", finalUrl: null });
    expect(door("Chaldal")).toMatchObject({ kind: "timed_out", error: "timeout" });
    expect(door("Lygos")).toMatchObject({ kind: "error", error: "target_http_error" });
    expect(door("PhysioHealth")).toMatchObject({ kind: "error", error: "target_unreachable" });
    expect(door("Restocks")).toMatchObject({ kind: "error", error: "page_not_found" });
    expect(door("Wink Health")).toMatchObject({ kind: "blocked", error: "bot_blocked" });
    expect(readDoor({ url: "https://acme.com/", ok: false, error: "login_required" }, "Acme", "https://acme.com/").kind).toBe("blocked");
    expect(readDoor({ url: "https://acme.com/", ok: false, error: "something_new" }, "Acme", "https://acme.com/").kind).toBe("error");
  });

  it("records the second knock", () => {
    expect(door("Chaldal", 2).knocks).toBe(2);
  });

  it("does not call a move within the same site a forward", () => {
    expect(readDoor(page({ finalUrl: "https://www.acme.com/home" }), "Acme", "http://acme.com/").kind).toBe("answers");
    expect(readDoor(page({ finalUrl: "https://app.acme.com/" }), "Acme", "https://acme.com/").kind).toBe("answers");
  });

  it("takes a forward for the company when only the host carries its name", () => {
    const d = readDoor(page({ finalUrl: "https://getacmeapp.io/", text: "The anvil people. ".repeat(40), title: "Home" }), "AcmeApp", "https://acmeapp.com/");
    expect(d).toMatchObject({ kind: "forwards", toHost: "getacmeapp.io", namesIt: true });
  });
});

describe("finding a jobs page and a sign-up page among a home page's links", () => {
  const links = [
    "https://acme.com/",
    "https://acme.com/blog/we-are-hiring-engineers",
    "https://acme.com/about",
    "https://acme.com/login",
    "https://acme.com/pricing",
    "https://boards.greenhouse.io/acme",
    "https://twitter.com/acme",
    "https://other.com/careers",
  ];

  it("prefers a jobs page on the site, then a jobs board", () => {
    expect(findLink([...links, "https://acme.com/careers/"], "jobs", "acme.com")).toBe("https://acme.com/careers/");
    expect(findLink(links, "jobs", "acme.com")).toBe("https://boards.greenhouse.io/acme");
    expect(findLink(["https://acme.com/about", "https://other.com/careers"], "jobs", "acme.com")).toBeNull();
  });

  it("prefers signing up over prices over logging in", () => {
    expect(findLink([...links, "https://app.acme.com/signup"], "signup", "acme.com")).toBe("https://app.acme.com/signup");
    expect(findLink(links, "signup", "acme.com")).toBe("https://acme.com/pricing");
    expect(findLink(["https://acme.com/login"], "signup", "acme.com")).toBe("https://acme.com/login");
    expect(findLink(["https://acme.com/about"], "signup", "acme.com")).toBeNull();
  });

  it("takes no link that is not a web page", () => {
    expect(findLink(["mailto:jobs@acme.com", "javascript:void(0)", "not a link"], "jobs", "acme.com")).toBeNull();
  });
});
