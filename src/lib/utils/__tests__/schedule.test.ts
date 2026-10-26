import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildTimeWindow,
  describeDays,
  formatStartTime,
  formatWindow,
  movableDayKeys,
  newExceptionDays,
  parseTimeWindow,
  settleTimeFields,
  timeFieldsFromWindow,
  timeWindowGroups,
  windowOn,
  type TimeException,
  type TimeWindowFields,
} from "../schedule";

// Wednesday 18 June 2025, noon UTC.
const WEDNESDAY = new Date("2025-06-18T12:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(WEDNESDAY);
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * A rain check may only be moved onto a day the habit is free. A day it is
 * already scheduled for has its own occurrence, so moving there would
 * double-book it and let work that was happening anyway settle the skip.
 */
describe("movableDayKeys", () => {
  it("skips the days the habit is already scheduled for", () => {
    // Mon/Wed/Fri: Fri 20, Mon 23 and Wed 25 are spoken for.
    expect(movableDayKeys({ schedule: { days: [1, 3, 5] } }, "UTC", 7)).toEqual([
      "2025-06-19", // Thu
      "2025-06-21", // Sat
      "2025-06-22", // Sun
      "2025-06-24", // Tue
    ]);
  });

  it("offers nothing for a habit scheduled every day", () => {
    expect(
      movableDayKeys({ schedule: { days: [0, 1, 2, 3, 4, 5, 6] } }, "UTC", 7),
    ).toEqual([]);
  });

  it("treats a missing or empty schedule as daily", () => {
    expect(movableDayKeys({ schedule: null }, "UTC", 7)).toEqual([]);
    expect(movableDayKeys({ schedule: { days: [] } }, "UTC", 7)).toEqual([]);
  });

  it("offers every other day for a once-a-week habit", () => {
    // Wednesdays only — free every day but next Wednesday.
    expect(movableDayKeys({ schedule: { days: [3] } }, "UTC", 7)).toEqual([
      "2025-06-19",
      "2025-06-20",
      "2025-06-21",
      "2025-06-22",
      "2025-06-23",
      "2025-06-24",
    ]);
  });

  it("never offers today, however far the window reaches", () => {
    const keys = movableDayKeys({ schedule: { days: [3] } }, "UTC", 14);
    expect(keys).not.toContain("2025-06-18");
    expect(keys[0]).toBe("2025-06-19");
  });

  it("reads the weekday in the habit owner's timezone", () => {
    // 18 June 23:30 UTC is already Thursday the 19th in Auckland, so a
    // Thursday-only habit has no free Thursday until the week is out.
    vi.setSystemTime(new Date("2025-06-18T23:30:00Z"));
    const keys = movableDayKeys(
      { schedule: { days: [4] } },
      "Pacific/Auckland",
      7,
    );
    expect(keys[0]).toBe("2025-06-20");
    expect(keys).not.toContain("2025-06-26");
  });
});

describe("formatStartTime", () => {
  it("drops the minutes on the hour, the way the habit card reads", () => {
    expect(formatStartTime("09:00")).toBe("9 AM");
    expect(formatStartTime("00:00")).toBe("12 AM");
    expect(formatStartTime("12:00")).toBe("12 PM");
  });

  it("keeps them otherwise, padded", () => {
    expect(formatStartTime("21:05")).toBe("9:05 PM");
  });

  it("is null for a missing or malformed start", () => {
    expect(formatStartTime(undefined)).toBeNull();
    expect(formatStartTime("")).toBeNull();
    expect(formatStartTime("soon")).toBeNull();
  });
});

// 8 to 9, but 4 to 5 at the weekend, and any time on Tuesday.
const RUN = {
  start: "08:00",
  end: "09:00",
  days: {
    "0": { start: "16:00", end: "17:00" },
    "6": { start: "16:00", end: "17:00" },
    "2": null,
  },
};
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

describe("parseTimeWindow", () => {
  it("reads the days that differ, keyed by weekday", () => {
    expect(parseTimeWindow(RUN)).toEqual({
      start: "08:00",
      end: "09:00",
      days: {
        0: { start: "16:00", end: "17:00" },
        6: { start: "16:00", end: "17:00" },
        2: null,
      },
    });
  });

  it("drops entries that are not a weekday, or not a window", () => {
    expect(
      parseTimeWindow({
        start: "08:00",
        end: "09:00",
        days: { "7": null, sat: null, "1": "16:00", "3": { start: "16:00" } },
      }),
    ).toEqual({ start: "08:00", end: "09:00" });
  });
});

describe("windowOn", () => {
  const tw = parseTimeWindow(RUN);

  it("is the day's own window where it has one", () => {
    expect(windowOn(tw, 6)).toEqual({ start: "16:00", end: "17:00" });
  });

  it("is the usual window on any other day", () => {
    expect(windowOn(tw, 3)).toEqual({ start: "08:00", end: "09:00" });
  });

  it("is null on a day with no set time, and for no window at all", () => {
    expect(windowOn(tw, 2)).toBeNull();
    expect(windowOn(null, 3)).toBeNull();
  });
});

describe("timeWindowGroups", () => {
  it("puts the usual time first, then each different one", () => {
    expect(timeWindowGroups(parseTimeWindow(RUN), EVERY_DAY)).toEqual([
      { days: [1, 3, 4, 5], window: { start: "08:00", end: "09:00" } },
      { days: [0, 6], window: { start: "16:00", end: "17:00" } },
      { days: [2], window: null },
    ]);
  });

  it("only groups the days the habit repeats on", () => {
    expect(timeWindowGroups(parseTimeWindow(RUN), [1, 3, 5])).toEqual([
      { days: [1, 3, 5], window: { start: "08:00", end: "09:00" } },
    ]);
  });

  it("reads a day whose own time is the usual one as the usual time", () => {
    const tw = parseTimeWindow({
      start: "08:00",
      end: "09:00",
      days: { "6": { start: "08:00", end: "09:00" } },
    });
    expect(timeWindowGroups(tw, EVERY_DAY)).toEqual([
      { days: EVERY_DAY, window: { start: "08:00", end: "09:00" } },
    ]);
  });
});

describe("describeDays", () => {
  it("names the sets the Repeat menu does", () => {
    expect(describeDays(EVERY_DAY)).toBe("Every day");
    expect(describeDays([5, 4, 3, 2, 1])).toBe("Weekdays");
    expect(describeDays([6, 0])).toBe("Weekends");
  });

  it("lists any other days, Sunday first", () => {
    expect(describeDays([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(describeDays([6, 0, 3])).toBe("Sun, Wed, Sat");
  });
});

describe("formatWindow", () => {
  it("reads both ends as the card reads a start", () => {
    expect(formatWindow({ start: "08:00", end: "09:30" })).toBe("8 AM – 9:30 AM");
  });
});

describe("newExceptionDays", () => {
  it("takes the weekend when there are weekdays to leave", () => {
    expect(newExceptionDays(EVERY_DAY)).toEqual([0, 6]);
    expect(newExceptionDays([1, 3, 6])).toEqual([6]);
  });

  it("otherwise takes the last day", () => {
    expect(newExceptionDays([1, 2, 3, 4, 5])).toEqual([5]);
    expect(newExceptionDays([0, 6])).toEqual([6]);
  });
});

function exception(days: number[], window: { start: string; end: string } | null): TimeException {
  return {
    id: `e-${days.join("")}`,
    days,
    timed: window !== null,
    start: window?.start ?? "08:00",
    end: window?.end ?? "09:00",
  };
}

function fields(patch: Partial<TimeWindowFields> = {}): TimeWindowFields {
  return {
    frequency: "daily",
    scheduleDays: EVERY_DAY,
    timeWindowEnabled: true,
    timeWindowStart: "08:00",
    timeWindowEnd: "09:00",
    timeWindowExceptions: [],
    ...patch,
  };
}

describe("buildTimeWindow", () => {
  it("is null with the window off", () => {
    expect(buildTimeWindow(fields({ timeWindowEnabled: false }))).toBeNull();
  });

  it("always sends the days, {} for none", () => {
    expect(buildTimeWindow(fields())).toEqual({ start: "08:00", end: "09:00", days: {} });
  });

  it("stores each exception's days, null for no set time", () => {
    const stored = buildTimeWindow(
      fields({
        timeWindowExceptions: [
          exception([0, 6], { start: "16:00", end: "17:00" }),
          exception([2], null),
        ],
      }),
    );
    expect(stored).toEqual(RUN);
    // Weekday order, whatever order they were picked in.
    expect(Object.keys(stored!.days)).toEqual(["0", "2", "6"]);
  });

  it("keeps only the days the habit repeats on", () => {
    expect(
      buildTimeWindow(
        fields({
          scheduleDays: [1, 2, 3, 4, 5, 6],
          timeWindowExceptions: [exception([0, 6], { start: "16:00", end: "17:00" })],
        }),
      )?.days,
    ).toEqual({ "6": { start: "16:00", end: "17:00" } });
  });

  it("drops an exception left on the usual time", () => {
    expect(
      buildTimeWindow(
        fields({ timeWindowExceptions: [exception([0, 6], { start: "08:00", end: "09:00" })] }),
      )?.days,
    ).toEqual({});
  });

  it("stores no days for a weekly habit", () => {
    expect(
      buildTimeWindow(
        fields({
          frequency: "weekly",
          timeWindowExceptions: [exception([0, 6], { start: "16:00", end: "17:00" })],
        }),
      ),
    ).toEqual({ start: "08:00", end: "09:00", days: {} });
  });

  it("gives a day to the first exception that claims it", () => {
    expect(
      buildTimeWindow(
        fields({
          timeWindowExceptions: [
            exception([6], { start: "16:00", end: "17:00" }),
            exception([0, 6], { start: "18:00", end: "19:00" }),
          ],
        }),
      )?.days,
    ).toEqual({
      "0": { start: "18:00", end: "19:00" },
      "6": { start: "16:00", end: "17:00" },
    });
  });
});

describe("settleTimeFields", () => {
  it("makes the first timed exception the usual time when the usual has no days left", () => {
    // Monday was the usual day, and has just left Repeat.
    const settled = settleTimeFields(
      fields({
        scheduleDays: [2, 3, 4, 5, 6],
        timeWindowExceptions: [
          exception([2], null),
          exception([3, 4, 5], { start: "18:00", end: "19:00" }),
          exception([6], { start: "16:00", end: "17:00" }),
        ],
      }),
    );
    expect(settled.timeWindowStart).toBe("18:00");
    expect(settled.timeWindowEnd).toBe("19:00");
    expect(settled.timeWindowExceptions.map((e) => e.days)).toEqual([[2], [6]]);
  });

  it("turns the window off when every day left has no set time", () => {
    expect(
      settleTimeFields(
        fields({ scheduleDays: [2], timeWindowExceptions: [exception([2], null)] }),
      ).timeWindowEnabled,
    ).toBe(false);
  });

  it("leaves a habit with no days alone: Repeat is asking for one", () => {
    const before = fields({ scheduleDays: [], timeWindowExceptions: [exception([2], null)] });
    expect(settleTimeFields(before)).toBe(before);
  });
});

describe("timeFieldsFromWindow", () => {
  it("opens a stored window as the usual time and its exceptions", () => {
    const fromStore = timeFieldsFromWindow(RUN, EVERY_DAY);
    expect(fromStore).toMatchObject({
      timeWindowEnabled: true,
      timeWindowStart: "08:00",
      timeWindowEnd: "09:00",
      timeWindowExceptions: [
        { days: [0, 6], timed: true, start: "16:00", end: "17:00" },
        // No set time, ready on the usual one if it is turned back on.
        { days: [2], timed: false, start: "08:00", end: "09:00" },
      ],
    });
    // And saves back as it was.
    expect(buildTimeWindow({ ...fromStore, frequency: "daily", scheduleDays: EVERY_DAY })).toEqual(RUN);
  });

  it("is off, on the default window, with none stored", () => {
    expect(timeFieldsFromWindow(null, EVERY_DAY)).toEqual({
      timeWindowEnabled: false,
      timeWindowStart: "09:00",
      timeWindowEnd: "12:00",
      timeWindowExceptions: [],
    });
  });
});
