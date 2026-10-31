import { describe, it, expect } from "vitest";
import { dailyCounts, dayHabits, groupDay, isWeekStart, weekDays, weekRangeLabel, weekRate, type DayHabit } from "../weekly-review";

describe("isWeekStart", () => {
  it("takes a Sunday's key", () => {
    expect(isWeekStart("2026-10-18")).toBe(true);
  });

  it("refuses other days, impossible dates and other shapes", () => {
    expect(isWeekStart("2026-10-19")).toBe(false);
    expect(isWeekStart("2026-02-30")).toBe(false);
    expect(isWeekStart("2026-10-18T00:00")).toBe(false);
    expect(isWeekStart("latest")).toBe(false);
  });
});

describe("weekDays", () => {
  it("runs Sunday to Saturday, across a month's end", () => {
    expect(weekDays("2026-09-27")).toEqual([
      "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30",
      "2026-10-01", "2026-10-02", "2026-10-03",
    ]);
  });
});

describe("weekRangeLabel", () => {
  it("names the month once within a month", () => {
    expect(weekRangeLabel("2026-10-18", 2026)).toBe("Oct 18 – 24");
  });

  it("names both months across a month's end", () => {
    expect(weekRangeLabel("2026-09-27", 2026)).toBe("Sep 27 – Oct 3");
  });

  it("adds the year when it is not this one", () => {
    expect(weekRangeLabel("2025-10-19", 2026)).toBe("Oct 19 – 25, 2025");
  });

  it("dates both ends across a year's end", () => {
    expect(weekRangeLabel("2026-12-27", 2026)).toBe("Dec 27, 2026 – Jan 2, 2027");
  });
});

describe("weekRate", () => {
  it("rounds days done of days due", () => {
    expect(weekRate({ due: 7, done: 5 })).toBe(71);
  });

  it("is null when nothing was due", () => {
    expect(weekRate({ due: 0, done: 0 })).toBeNull();
  });
});

describe("dailyCounts", () => {
  it("keeps numeric days and drops anything else", () => {
    expect(dailyCounts({ "2026-10-18": 2, "2026-10-19": "x" })).toEqual({ "2026-10-18": 2 });
    expect(dailyCounts(null)).toEqual({});
    expect(dailyCounts([1, 2])).toEqual({});
  });
});

describe("dayHabits", () => {
  const days = {
    "2026-10-21": [
      { habit_id: "run", title: "Run", emoji: "🏃", weekly: false, status: "done", times: ["06:45", 7], reason: null },
      { habit_id: "call", title: "Call", emoji: "☎️", weekly: true, status: "open", times: [], reason: null },
      { habit_id: "bad", title: "Bad", status: "sideways" },
      "junk",
    ],
  };

  it("reads a day's habits, dropping malformed ones", () => {
    expect(dayHabits(days, "2026-10-21")).toEqual([
      { habitId: "run", title: "Run", emoji: "🏃", weekly: false, status: "done", times: ["06:45"], reason: null },
      { habitId: "call", title: "Call", emoji: "☎️", weekly: true, status: "open", times: [], reason: null },
    ]);
  });

  it("has nothing for a day it lacks, or a column that is not a map", () => {
    expect(dayHabits(days, "2026-10-22")).toEqual([]);
    expect(dayHabits(null, "2026-10-21")).toEqual([]);
  });
});

describe("groupDay", () => {
  const habit = (title: string, status: DayHabit["status"]): DayHabit => ({
    habitId: title, title, emoji: null, weekly: false, status, times: [], reason: null,
  });

  it("sorts done, not done, excused, not due and done another day, and leaves the days to come out", () => {
    const groups = groupDay([
      habit("a", "done"), habit("b", "done_week"), habit("c", "extra"),
      habit("d", "missed"), habit("e", "pending"), habit("f", "open"),
      habit("g", "excused"), habit("h", "paused"), habit("i", "off"), habit("j", "upcoming"),
    ]);
    expect(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((h) => h.title).join("")]))).toEqual({
      done: "ac",
      notDone: "def",
      excused: "gh",
      notDue: "i",
      doneThisWeek: "b",
    });
  });
});
