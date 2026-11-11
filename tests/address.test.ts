import { describe, expect, it } from "vitest";
import { cleanAddress, hostOf, otherScheme, sameSite, sameUrl, siteOf } from "../src/core/address";

describe("an address as Knock asks it", () => {
  it("takes addresses however they are written", () => {
    expect(cleanAddress("stripe.com")).toBe("https://stripe.com/");
    expect(cleanAddress("  WWW.Stripe.com/ ")).toBe("https://www.stripe.com/");
    expect(cleanAddress("http://stripe.com/about")).toBe("http://stripe.com/about");
    expect(cleanAddress("HTTPS://Stripe.com/Blog?x=1#top")).toBe("https://stripe.com/Blog?x=1");
    expect(cleanAddress('"tarsnap.com"')).toBe("https://tarsnap.com/");
    expect(cleanAddress("<https://vine.co>")).toBe("https://vine.co/");
    expect(cleanAddress("//secret.ly")).toBe("https://secret.ly/");
    expect(cleanAddress("münchen.de")).toBe("https://xn--mnchen-3ya.de/");
  });

  it("says no address for what is not one", () => {
    for (const raw of ["", "   ", "n/a", "N/A", "-", "none", "null", "unknown", "tbd", "hello@stripe.com", "mailto:hello@stripe.com", "ftp://files.example.com", "Stripe Inc", "stripe", "http://", "https://", "localhost", "192.168.1.1", "http://10.0.0.1/admin", "javascript:alert(1)", "example.c", "a..b.com"]) {
      expect(cleanAddress(raw), raw).toBeNull();
    }
  });
});

describe("hosts and sites", () => {
  it("gives a host without its www", () => {
    expect(hostOf("https://www.Stripe.com/blog")).toBe("stripe.com");
    expect(hostOf("https://blog.heroku.com")).toBe("blog.heroku.com");
    expect(hostOf("not an address")).toBe("");
  });

  it("gives the site a host belongs to", () => {
    expect(siteOf("blog.heroku.com")).toBe("heroku.com");
    expect(siteOf("stripe.com")).toBe("stripe.com");
    expect(siteOf("shop.example.co.uk")).toBe("example.co.uk");
    expect(siteOf("example.com.au")).toBe("example.com.au");
    // On a shared host the first label is the site.
    expect(siteOf("acme.github.io")).toBe("acme.github.io");
    expect(siteOf("www.acme.webflow.io")).toBe("acme.webflow.io");
  });

  it("tells whether two addresses are the same site", () => {
    expect(sameSite("https://www.stripe.com/", "https://dashboard.stripe.com/login")).toBe(true);
    expect(sameSite("https://parse.com/", "https://parseplatform.org/")).toBe(false);
    expect(sameSite("https://acme.github.io/", "https://other.github.io/")).toBe(false);
  });

  it("tells whether two addresses are the same page, whatever the last slash, the www or the capitals", () => {
    expect(sameUrl("https://Stripe.com", "https://stripe.com/")).toBe(true);
    expect(sameUrl("https://www.stripe.com/blog/", "https://www.stripe.com/blog")).toBe(true);
    expect(sameUrl("https://stripe.com/blog", "https://stripe.com/jobs")).toBe(false);
    expect(sameUrl("http://stripe.com/", "https://stripe.com/")).toBe(false);
  });

  it("gives the same address with the other scheme, for a second knock", () => {
    expect(otherScheme("https://stripe.com/about")).toBe("http://stripe.com/about");
    expect(otherScheme("http://stripe.com/")).toBe("https://stripe.com/");
  });
});
