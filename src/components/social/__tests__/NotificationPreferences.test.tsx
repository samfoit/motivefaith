import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NotificationPreferences } from "../NotificationPreferences";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/rpc", () => ({ untypedRpc: vi.fn(async () => ({ data: null, error: null })) }));

describe("NotificationPreferences quiet hours", () => {
  it("picks them with the habit form's picker, past midnight as usual", async () => {
    const onChange = vi.fn();
    render(
      <NotificationPreferences
        notificationPrefs={{ quiet_start: "22:00", quiet_end: "07:00" }}
        onChange={onChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "From, 10 PM" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "From time" })).getByRole("radio", { name: "11" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ quiet_start: "23:00", quiet_end: "07:00" }),
    );

    await userEvent.click(screen.getByRole("button", { name: "To, 7 AM" }));
    await userEvent.click(
      within(screen.getByRole("group", { name: "To time" })).getByRole("radio", { name: ":30" }),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ quiet_start: "23:00", quiet_end: "07:30" }),
    );
    expect(screen.getByRole("button", { name: "To, 7:30 AM" })).toBeInTheDocument();
  });
});
