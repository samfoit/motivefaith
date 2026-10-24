import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkinSharingKey,
  type AudienceMember,
  type CheckinSharing,
} from "@/lib/data/checkin-sharing";
import { useCheckinSharingStore } from "@/lib/stores/checkin-sharing-store";
import { CheckinSharingDialog } from "../CheckinSharingDialog";

const rpc = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/supabase/rpc", () => ({
  untypedRpc: (_client: unknown, name: string) => rpc(name),
}));
vi.mock("@/lib/hooks/useAuthUserId", () => ({ useAuthUserId: () => "me" }));

const PAT: AudienceMember = {
  habit_id: "run",
  kind: "partner",
  id: "pat",
  name: "Pat Lee",
  avatar_url: null,
};
const CIRCLE: AudienceMember = {
  habit_id: "run",
  kind: "group",
  id: "circle",
  name: "Prayer Circle",
  avatar_url: null,
};

/** What PostgREST hands back when the request never got anywhere. */
const NO_CONNECTION = { message: "TypeError: Failed to fetch", code: "" };

let server: CheckinSharing;

beforeEach(() => {
  server = { confirmed: false, audience: [PAT, CIRCLE] };
  rpc.mockReset().mockImplementation(async (name: string) => {
    if (name === "confirm_checkin_sharing") {
      server = { confirmed: true, audience: [] };
      return { data: null, error: null };
    }
    return { data: server, error: null };
  });
  useCheckinSharingStore.setState({ question: null, waiting: [] });
});

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CheckinSharingDialog />
    </QueryClientProvider>,
  );
  return queryClient;
}

function ask(audience: AudienceMember[] | null) {
  let answered!: Promise<boolean>;
  act(() => {
    answered = useCheckinSharingStore.getState().ask(audience);
  });
  return answered;
}

describe("CheckinSharingDialog", () => {
  it("shows nothing until a check-in asks", () => {
    renderDialog();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("names who the check-in goes to", async () => {
    renderDialog();
    void ask([PAT, CIRCLE]);

    const dialog = await screen.findByRole("alertdialog", {
      name: "Your partners will see this",
    });
    const list = within(dialog).getByRole("list", { name: "Shared with" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Pat Lee");
    expect(rows[1]).toHaveTextContent("Prayer Circle");
    expect(rows[1]).toHaveTextContent("Group");
    expect(dialog).toHaveAccessibleDescription(/shows up in your chat/);
  });

  it("explains without names when who it reaches isn't known", async () => {
    renderDialog();
    void ask(null);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByRole("list")).not.toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription(
      /Everyone you've added as a partner on this habit/,
    );
  });

  it("lets the check-in through on yes, and remembers it", async () => {
    const queryClient = renderDialog();
    const answered = ask([PAT]);

    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );

    await expect(answered).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(queryClient.getQueryData(checkinSharingKey("me"))).toEqual({
        confirmed: true,
        audience: [],
      }),
    );
    expect(rpc).toHaveBeenCalledWith("confirm_checkin_sharing");
  });

  it("sends nothing on \"Not now\", and asks again next time", async () => {
    const queryClient = renderDialog();
    const answered = ask([PAT]);

    await userEvent.click(
      await screen.findByRole("button", { name: "Not now" }),
    );

    await expect(answered).resolves.toBe(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith("confirm_checkin_sharing");
    expect(
      queryClient.getQueryData<CheckinSharing>(checkinSharingKey("me"))
        ?.confirmed,
    ).not.toBe(true);
  });

  it("takes Escape as \"Not now\"", async () => {
    renderDialog();
    const answered = ask([PAT]);
    await screen.findByRole("alertdialog");

    await userEvent.keyboard("{Escape}");
    await expect(answered).resolves.toBe(false);
  });

  it("doesn't take a tap beside it as an answer", async () => {
    renderDialog();
    const answered = ask([PAT]);
    await screen.findByRole("alertdialog");

    // Radix turns pointer events off behind a modal, so userEvent won't tap
    // there; this is the event its outside-tap dismissal listens for.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    const settled = vi.fn();
    void answered.then(settled);
    await act(async () => {});
    expect(settled).not.toHaveBeenCalled();
  });

  it("never asks again on this device after a yes given offline, and tells the server later", async () => {
    const queryClient = renderDialog();
    // Mounting fetched the answer; now the connection goes.
    await waitFor(() =>
      expect(queryClient.getQueryData(checkinSharingKey("me"))).toBeDefined(),
    );
    rpc.mockResolvedValue({ data: null, error: NO_CONNECTION });

    const answered = ask([PAT]);
    await userEvent.click(
      await screen.findByRole("button", { name: "Continue" }),
    );
    await expect(answered).resolves.toBe(true);

    await waitFor(() =>
      expect(queryClient.getQueryData(checkinSharingKey("me"))).toEqual({
        confirmed: true,
        audience: [],
        unsent: true,
      }),
    );

    // Back online: the next fetch hands the server the yes before it asks
    // for anything, so the answer it gets back already has it.
    rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === "confirm_checkin_sharing") {
        server = { confirmed: true, audience: [] };
        return { data: null, error: null };
      }
      return { data: server, error: null };
    });
    await act(() =>
      queryClient.refetchQueries({ queryKey: checkinSharingKey("me") }),
    );

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "confirm_checkin_sharing",
      "get_checkin_audience",
    ]);
    expect(queryClient.getQueryData(checkinSharingKey("me"))).toEqual({
      confirmed: true,
      audience: [],
    });
  });
});
