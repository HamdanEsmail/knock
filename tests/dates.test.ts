import { describe, expect, it } from "vitest";
import { dayOf, httpDay, monthsAgo, monthsBefore, searchDay, showDay } from "../src/core/dates";

const TODAY = "2026-11-12";

describe("a date as Search gives it", () => {
  it("reads the shapes Search uses", () => {
    expect(searchDay("May 7, 2026", TODAY)).toBe("2026-05-07");
    expect(searchDay("Oct 23, 2026", TODAY)).toBe("2026-10-23");
    expect(searchDay("September 3, 2019", TODAY)).toBe("2019-09-03");
    expect(searchDay("Sept. 3, 2019", TODAY)).toBe("2019-09-03");
    expect(searchDay("7 May 2026", TODAY)).toBe("2026-05-07");
    expect(searchDay("2026-05-07", TODAY)).toBe("2026-05-07");
    expect(searchDay("2026-05-07T10:00:00.000Z", TODAY)).toBe("2026-05-07");
  });

  it("reads a date told as time gone by", () => {
    expect(searchDay("7 days ago", TODAY)).toBe("2026-11-05");
    expect(searchDay("1 day ago", TODAY)).toBe("2026-11-11");
    expect(searchDay("5 hours ago", TODAY)).toBe("2026-11-12");
    expect(searchDay("2 weeks ago", TODAY)).toBe("2026-10-29");
    expect(searchDay("3 months ago", TODAY)).toBe("2026-08-12");
    expect(searchDay("1 year ago", TODAY)).toBe("2025-11-12");
  });

  it("gives no date for anything else", () => {
    for (const v of ["", "soon", "Feb 30, 2026", "13/14/2026", "May 2026", "2026", "0000-00-00", "tomorrow", null, undefined, 20260507, {}]) {
      expect(searchDay(v, TODAY), String(v)).toBeNull();
    }
  });

  it("gives no date for a day that has not come yet", () => {
    expect(searchDay("Dec 25, 2026", TODAY)).toBeNull();
    expect(searchDay("2026-11-13", TODAY)).toBeNull();
    expect(searchDay("2026-11-12", TODAY)).toBe("2026-11-12");
  });
});

describe("days and months", () => {
  it("counts whole months between a day and today", () => {
    expect(monthsAgo("2026-11-12", TODAY)).toBe(0);
    expect(monthsAgo("2025-11-13", TODAY)).toBe(11);
    expect(monthsAgo("2025-11-12", TODAY)).toBe(12);
    expect(monthsAgo("2023-11-13", TODAY)).toBe(35);
    expect(monthsAgo("2023-11-12", TODAY)).toBe(36);
    expect(monthsAgo("2015-12-22", TODAY)).toBe(130);
  });

  it("gives the day so many months before", () => {
    expect(monthsBefore(TODAY, 12)).toBe("2025-11-12");
    expect(monthsBefore(TODAY, 36)).toBe("2023-11-12");
    expect(monthsBefore("2026-03-31", 1)).toBe("2026-02-28");
  });

  it("reads the date a server gives for a page", () => {
    expect(httpDay("Wed, 11 Nov 2026 17:25:52 GMT")).toBe("2026-11-11");
    expect(httpDay("Sat, 03 Jan 2015 08:00:00 GMT")).toBe("2015-01-03");
    expect(httpDay("yesterday")).toBeNull();
    expect(httpDay(null)).toBeNull();
  });

  it("reads the day from a page's own date and shows a day in words", () => {
    expect(dayOf("2026-10-30T19:31:51.000Z")).toBe("2026-10-30");
    expect(dayOf("30 October 2026")).toBeNull();
    expect(dayOf(null)).toBeNull();
    expect(showDay("2026-11-05")).toBe("5 Nov 2026");
  });
});
