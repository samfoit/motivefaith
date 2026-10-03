import { describe, it, expect } from "vitest";
import type { DashboardData } from "@/lib/data/dashboard";
import { applyHabitUpdate, removeHabit } from "@/lib/data/dashboard-mutations";

const habit = (id: string, color: string | null) =>
  ({ id, title: id, color, completions: [] }) as unknown as DashboardData["habits"][number];

const data = {
  habits: [habit("a", "#111111"), habit("b", "#222222")],
  firstName: "Sam",
} as unknown as DashboardData;

describe("applyHabitUpdate", () => {
  it("patches only the edited habit", () => {
    const next = applyHabitUpdate(data, "a", { color: "#ff0000" });
    expect(next?.habits[0].color).toBe("#ff0000");
    expect(next?.habits[1].color).toBe("#222222");
    expect(data.habits[0].color).toBe("#111111");
  });

  it("leaves an empty cache empty", () => {
    expect(applyHabitUpdate(undefined, "a", { color: "#ff0000" })).toBeUndefined();
  });
});

describe("removeHabit", () => {
  it("drops the habit from the list", () => {
    expect(removeHabit(data, "a")?.habits.map((h) => h.id)).toEqual(["b"]);
  });
});
