import { describe, it, expect } from "vitest";
import { countPausedDays, isPausedOn, pauseStartOn } from "../pauses";

describe("pauseStartOn", () => {
  const pause = { started_on: "2025-06-10", ended_on: "2025-06-13" };

  it("covers the first day paused up to, not including, the day back", () => {
    expect(pauseStartOn([pause], "2025-06-09")).toBeNull();
    expect(pauseStartOn([pause], "2025-06-10")).toBe("2025-06-10");
    expect(pauseStartOn([pause], "2025-06-12")).toBe("2025-06-10");
    expect(pauseStartOn([pause], "2025-06-13")).toBeNull();
  });

  it("covers every day from its start while still paused", () => {
    expect(pauseStartOn([{ started_on: "2025-06-10", ended_on: null }], "2030-01-01")).toBe(
      "2025-06-10",
    );
  });

  it("gives the earliest start among pauses that overlap", () => {
    const pauses = [pause, { started_on: "2025-06-08", ended_on: "2025-06-12" }];
    expect(pauseStartOn(pauses, "2025-06-11")).toBe("2025-06-08");
  });

  it("is never paused without a pause", () => {
    expect(isPausedOn([], "2025-06-10")).toBe(false);
  });
});

describe("countPausedDays", () => {
  it("counts the days paused, the day back not among them", () => {
    const pauses = [{ started_on: "2025-06-10", ended_on: "2025-06-13" }];
    expect(countPausedDays(pauses, "2025-06-01", "2025-06-30")).toBe(3);
  });

  it("counts only the days within the range", () => {
    const pauses = [{ started_on: "2025-05-28", ended_on: "2025-06-03" }];
    expect(countPausedDays(pauses, "2025-06-01", "2025-06-30")).toBe(2);
  });

  it("runs an open pause up to the end of the range", () => {
    const pauses = [{ started_on: "2025-06-28", ended_on: null }];
    expect(countPausedDays(pauses, "2025-06-01", "2025-06-30")).toBe(3);
  });

  it("counts a day once, however many pauses cover it", () => {
    const pauses = [
      { started_on: "2025-06-10", ended_on: "2025-06-13" },
      { started_on: "2025-06-12", ended_on: "2025-06-14" },
    ];
    expect(countPausedDays(pauses, "2025-06-01", "2025-06-30")).toBe(4);
  });

  it("leaves out the days it is told to", () => {
    const pauses = [{ started_on: "2025-06-10", ended_on: "2025-06-13" }];
    expect(
      countPausedDays(pauses, "2025-06-01", "2025-06-30", new Set(["2025-06-11"])),
    ).toBe(2);
  });
});
