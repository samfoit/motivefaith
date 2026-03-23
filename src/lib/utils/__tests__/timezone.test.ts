import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getBrowserTimezone,
  toDateKey,
  todayDateKey,
  getDayOfWeek,
  subtractDays,
  DEFAULT_TIMEZONE,
} from "../timezone";

describe("getBrowserTimezone", () => {
  it("returns a string", () => {
    expect(typeof getBrowserTimezone()).toBe("string");
  });

  it("falls back to UTC when Intl is unavailable", () => {
    const origIntl = globalThis.Intl;
    // @ts-expect-error — intentionally removing Intl
    globalThis.Intl = undefined;
    expect(getBrowserTimezone()).toBe("UTC");
    globalThis.Intl = origIntl;
  });

  it("falls back to UTC when Intl throws", () => {
    const origDateTimeFormat = Intl.DateTimeFormat;
    // @ts-expect-error — intentionally breaking DateTimeFormat
    Intl.DateTimeFormat = () => {
      throw new Error("broken");
    };
    expect(getBrowserTimezone()).toBe("UTC");
    Intl.DateTimeFormat = origDateTimeFormat;
  });
});

describe("toDateKey", () => {
  it("converts a Date to YYYY-MM-DD in UTC", () => {
    const d = new Date("2025-06-15T10:00:00Z");
    expect(toDateKey(d, "UTC")).toBe("2025-06-15");
  });

  it("converts a Date to YYYY-MM-DD in America/New_York", () => {
    // 10am UTC = 6am ET on the same day
    const d = new Date("2025-06-15T10:00:00Z");
    expect(toDateKey(d, "America/New_York")).toBe("2025-06-15");
  });

  it("handles day boundary crossing (UTC midnight → prior day in US/Pacific)", () => {
    // UTC midnight is still previous day in Pacific (UTC-7 in summer)
    const d = new Date("2025-06-15T03:00:00Z");
    expect(toDateKey(d, "America/Los_Angeles")).toBe("2025-06-14");
  });

  it("accepts an ISO string input", () => {
    expect(toDateKey("2025-12-25T12:00:00Z", "UTC")).toBe("2025-12-25");
  });

  it("handles DST spring-forward transition", () => {
    // March 9, 2025: US clocks spring forward at 2am
    // 2:30am EST doesn't exist — 1:59am → 3:00am
    // 7:00 UTC = 2:00am EST which becomes 3:00am EDT = still March 9
    const d = new Date("2025-03-09T07:00:00Z");
    expect(toDateKey(d, "America/New_York")).toBe("2025-03-09");
  });

  it("handles DST fall-back transition", () => {
    // Nov 2, 2025: clocks fall back
    const d = new Date("2025-11-02T06:30:00Z");
    expect(toDateKey(d, "America/New_York")).toBe("2025-11-02");
  });
});

describe("todayDateKey", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a YYYY-MM-DD format string", () => {
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    const result = todayDateKey("UTC");
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns consistent result for same timezone", () => {
    vi.setSystemTime(new Date("2025-06-15T12:00:00Z"));
    expect(todayDateKey("UTC")).toBe("2025-06-15");
    expect(todayDateKey("UTC")).toBe("2025-06-15");
  });

  it("returns timezone-adjusted date", () => {
    // 3am UTC on June 15 = 8pm June 14 in US/Pacific
    vi.setSystemTime(new Date("2025-06-15T03:00:00Z"));
    expect(todayDateKey("America/Los_Angeles")).toBe("2025-06-14");
    expect(todayDateKey("UTC")).toBe("2025-06-15");
  });
});

describe("getDayOfWeek", () => {
  it("returns 0 for a known Sunday", () => {
    // June 15, 2025 is a Sunday
    expect(getDayOfWeek(new Date("2025-06-15T12:00:00Z"), "UTC")).toBe(0);
  });

  it("returns 6 for a known Saturday", () => {
    // June 14, 2025 is a Saturday
    expect(getDayOfWeek(new Date("2025-06-14T12:00:00Z"), "UTC")).toBe(6);
  });

  it("handles timezone causing day-of-week change", () => {
    // Sunday June 15 at 3am UTC = Saturday June 14 in US/Pacific
    expect(
      getDayOfWeek(new Date("2025-06-15T03:00:00Z"), "America/Los_Angeles"),
    ).toBe(6);
  });

  it("accepts a string input", () => {
    expect(getDayOfWeek("2025-06-15T12:00:00Z", "UTC")).toBe(0);
  });
});

describe("subtractDays", () => {
  it("subtracts 1 day", () => {
    expect(subtractDays("2025-06-15", 1)).toBe("2025-06-14");
  });

  it("crosses month boundary", () => {
    expect(subtractDays("2025-07-01", 1)).toBe("2025-06-30");
  });

  it("crosses year boundary", () => {
    expect(subtractDays("2025-01-01", 1)).toBe("2024-12-31");
  });

  it("subtracts 0 days (identity)", () => {
    expect(subtractDays("2025-06-15", 0)).toBe("2025-06-15");
  });

  it("subtracts 14 days", () => {
    expect(subtractDays("2025-06-15", 14)).toBe("2025-06-01");
  });
});

describe("DEFAULT_TIMEZONE", () => {
  it("is UTC", () => {
    expect(DEFAULT_TIMEZONE).toBe("UTC");
  });
});
