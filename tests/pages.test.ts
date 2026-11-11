import { describe, expect, it } from "vitest";
import { afterAsk, hitsOn, newAsk, nextWindow, windowDates } from "../src/core/pages";

const TODAY = "2026-11-12";
const result = (url: string, date: unknown, title = "A page", snippet = "") => ({ url, date, title, snippet, position: 1, site_name: "x" });

describe("the dated pages Search lists on a company's site", () => {
  it("keeps only dated pages on the site, the newest first", () => {
    const hits = hitsOn(
      [
        result("https://www.algolia.com/doc/guides/get-started", "Oct 23, 2026", "Get started"),
        result("https://other.com/algolia-review", "Nov 1, 2026", "A review"),
        result("https://www.algolia.com/about/news/velou", "Nov 3, 2026", "Algolia acquires Velou"),
        result("https://blog.algolia.com/old", "soon", "No date"),
        result("https://www.algolia.com/future", "Dec 30, 2026", "Not yet"),
        result("https://www.algolia.com/hire", "7 days ago", "Hire"),
        "not a result",
        { url: 5, date: "Nov 3, 2026" },
      ],
      "algolia.com",
      TODAY,
    );
    expect(hits).toEqual([
      { url: "https://www.algolia.com/hire", title: "Hire", date: "2026-11-05" },
      { url: "https://www.algolia.com/about/news/velou", title: "Algolia acquires Velou", date: "2026-11-03" },
      { url: "https://www.algolia.com/doc/guides/get-started", title: "Get started", date: "2026-10-23" },
    ]);
  });

  it("on a new address keeps only the pages that name the company", () => {
    const results = [
      result("https://www.nytimes.com/athletic/1/a", "Nov 2, 2026", "The Athletic: scores"),
      result("https://www.nytimes.com/2026/11/01/world/x", "Nov 1, 2026", "World news", "Nothing about sport"),
      result("https://www.nytimes.com/2026/10/01/sports/y", "Oct 1, 2026", "A match report", "From The Athletic's staff"),
    ];
    expect(hitsOn(results, "nytimes.com", TODAY, "The Athletic").map((h) => h.date)).toEqual(["2026-11-02", "2026-10-01"]);
  });
});

describe("asking window by window", () => {
  it("gives the dates of each window", () => {
    expect(windowDates("12", TODAY)).toEqual({ after: "2025-11-12" });
    expect(windowDates("36", TODAY)).toEqual({ after: "2023-11-12", before: "2025-11-12" });
    expect(windowDates("any", TODAY)).toEqual({});
  });

  it("is done at the first window that has a dated page", () => {
    const sign = afterAsk(newAsk("stripe.com"), "12", [result("https://stripe.com/blog/a", "Nov 5, 2026", "A"), result("https://stripe.com/blog/b", "Oct 1, 2026", "B")], TODAY);
    expect(sign).toMatchObject({ host: "stripe.com", done: true, asked: ["12"], found: "12", count: 2, failed: null });
    expect(sign.newest).toEqual({ url: "https://stripe.com/blog/a", title: "A", date: "2026-11-05" });
    expect(sign.second?.date).toBe("2026-10-01");
    expect(nextWindow(sign)).toBeNull();
  });

  it("asks the next window when one has nothing, and ends with nothing found", () => {
    let sign = newAsk("hickory.com");
    expect(nextWindow(sign)).toBe("12");
    sign = afterAsk(sign, "12", [], TODAY);
    expect(sign).toMatchObject({ done: false, asked: ["12"], found: null });
    expect(nextWindow(sign)).toBe("36");
    sign = afterAsk(sign, "36", [result("https://other.com/x", "Jan 1, 2025")], TODAY);
    expect(nextWindow(sign)).toBe("any");
    sign = afterAsk(sign, "any", [result("https://hickory.com/terms", null, "Terms")], TODAY);
    expect(sign).toMatchObject({ done: true, asked: ["12", "36", "any"], found: null, newest: null, count: 0, undated: 1 });
    expect(nextWindow(sign)).toBeNull();
  });

  it("names the window by the newest page's own age, whatever window was asked", () => {
    expect(afterAsk(newAsk("tarsnap.com"), "36", [result("https://tarsnap.com/a", "Mar 21, 2025")], TODAY)).toMatchObject({ done: true, found: "36" });
    expect(afterAsk(newAsk("rdio.com"), "any", [result("https://rdio.com/a", "Dec 22, 2015")], TODAY)).toMatchObject({ done: true, found: "any" });
  });
});
