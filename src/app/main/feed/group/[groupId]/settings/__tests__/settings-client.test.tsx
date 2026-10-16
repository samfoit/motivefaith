import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToastProvider } from "@/components/ui/Toast";
import type { Group, GroupMemberProfile } from "@/lib/types/groups";
import { SettingsClient } from "../settings-client";

const removeMember = vi.fn();
const updateRole = vi.fn();

vi.mock("@/lib/hooks/useGroups", () => ({
  useUpdateGroup: () => ({ mutateAsync: vi.fn() }),
  useDeleteGroup: () => ({ mutateAsync: vi.fn() }),
  useRemoveGroupMember: () => ({ mutateAsync: removeMember }),
  useUpdateMemberRole: () => ({ mutateAsync: updateRole }),
  useRegenerateInviteCode: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

const group = {
  id: "g1",
  name: "Morning Crew",
  description: null,
  avatar_url: null,
  invite_code: "abc",
} as unknown as Group;

function member(id: string, name: string, role: "admin" | "member"): GroupMemberProfile {
  return {
    id: `m-${id}`,
    group_id: "g1",
    user_id: id,
    role,
    joined_at: null,
    profile: { id, display_name: name, username: name.toLowerCase(), avatar_url: null },
  } as unknown as GroupMemberProfile;
}

function renderPage() {
  return render(
    <ToastProvider>
      <SettingsClient
        group={group}
        members={[member("me", "Sam", "admin"), member("b", "Bob", "member")]}
        userId="me"
      />
    </ToastProvider>,
  );
}

describe("Group settings", () => {
  beforeEach(() => {
    removeMember.mockReset().mockResolvedValue(undefined);
    updateRole.mockReset().mockResolvedValue(undefined);
  });

  it("shows Save only once the details change", async () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Name"), "!");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("has no options for your own row", () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Options for Sam" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Options for Bob" })).toBeInTheDocument();
  });

  it("asks before removing a member", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Options for Bob" }));
    await userEvent.click(await screen.findByRole("button", { name: /Remove from group/ }));

    expect(await screen.findByText("Remove Bob?")).toBeInTheDocument();
    expect(removeMember).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(removeMember).toHaveBeenCalledWith({ groupId: "g1", userId: "b" }),
    );
  });

  it("makes a member an admin from their options", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Options for Bob" }));
    await userEvent.click(await screen.findByRole("button", { name: /Make admin/ }));

    await waitFor(() =>
      expect(updateRole).toHaveBeenCalledWith({ groupId: "g1", userId: "b", role: "admin" }),
    );
  });
});
