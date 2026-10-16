import { describe, it, expect } from "vitest";
import { layoutRuns } from "../ChatParts";

const MIN = 60_000;

describe("layoutRuns", () => {
  it("runs one person's messages together, and starts a run on a new sender", () => {
    const runs = layoutRuns([
      { sender: "a", at: 0 },
      { sender: "a", at: 1 * MIN },
      { sender: "b", at: 2 * MIN },
    ]);
    expect(runs.map((r) => [r.first, r.last])).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
  });

  it("puts a time between items only once time has passed", () => {
    const runs = layoutRuns([
      { sender: "a", at: 0 },
      { sender: "a", at: 10 * MIN },
      { sender: "a", at: 30 * MIN },
    ]);
    expect(runs[0].divider).not.toBeNull();
    expect(runs[1].divider).toBeNull();
    expect(runs[2].divider).not.toBeNull();
    // A pause breaks the run even from the same person.
    expect(runs[1].first).toBe(true);
  });

  it("keeps an event out of anyone's run", () => {
    const runs = layoutRuns([
      { sender: "a", at: 0 },
      { sender: null, at: 1 * MIN },
      { sender: "a", at: 2 * MIN },
    ]);
    expect(runs.map((r) => r.first)).toEqual([true, true, true]);
  });
});
