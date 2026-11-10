import { describe, expect, it } from "vitest";
import { missedPush } from "../supabase/functions/check-missed-habits/missed-push";

/**
 * The partner push when a habit goes unlogged, worded as the card in the
 * owner's chat words it: a label for who and which habit, then where it
 * stands, so it reads right for any habit's name.
 */
describe("missed-habit push", () => {
  it("asks to remind them while the owner's day isn't over", () => {
    expect(
      missedPush({
        title: "No sugar",
        emoji: "🍎",
        user_name: "Olive",
        owner_date: "2026-11-08",
        owner_today: "2026-11-08",
      }),
    ).toEqual({ title: "Olive · 🍎 No sugar", body: "Not logged yet. Tap to remind them." });
  });

  it("asks to encourage them once the day went by", () => {
    expect(
      missedPush({
        title: "Run",
        emoji: "🏃",
        user_name: "Olive",
        owner_date: "2026-11-07",
        owner_today: "2026-11-08",
      }),
    ).toEqual({ title: "Olive · 🏃 Run", body: "Missed yesterday. Tap to encourage them." });
  });

  it("leaves out an emoji the habit doesn't have", () => {
    expect(
      missedPush({ title: "Run", emoji: null, user_name: "Olive", owner_date: "2026-11-08" }).title,
    ).toBe("Olive · Run");
  });
});
