import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock CSRF check — allow all requests in tests
vi.mock("@/lib/utils/csrf", () => ({
  verifyCsrf: vi.fn(() => null),
}));

// Mock requireAuthUser and helpers
const mockGetUser = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/utils/api-helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/utils/api-helpers")>();
  return {
    ...mod,
    requireAuthUser: vi.fn(async () => {
      const userResult = mockGetUser();
      if (!userResult?.data?.user) {
        return {
          ok: false as const,
          response: mod.jsonResponse({ error: "Unauthorized" }, { status: 401 }),
        };
      }
      return {
        ok: true as const,
        user: userResult.data.user,
        supabase: { rpc: mockRpc },
      };
    }),
  };
});

// Import after mock setup
const { POST } = await import("../route");

function makeRequest(body: Record<string, unknown> | unknown[]): Request {
  return new Request("http://localhost:3000/api/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: authenticated user
  mockGetUser.mockReturnValue({
    data: { user: { id: "user-123" } },
  });
  // Default: successful RPC
  mockRpc.mockResolvedValue({
    data: { id: "comp-1" },
    error: null,
  });
});

describe("POST /api/completions", () => {
  it("returns 401 when user is not authenticated", async () => {
    mockGetUser.mockReturnValue({ data: { user: null } });
    const res = await POST(makeRequest({ habitId: "h1", type: "quick" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 400 when habitId is missing", async () => {
    const res = await POST(makeRequest({ type: "quick" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("habitId");
  });

  it("returns 400 when type is missing", async () => {
    const res = await POST(makeRequest({ habitId: "h1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("type");
  });

  it("returns 201 with completion data on success", async () => {
    mockRpc.mockResolvedValue({
      data: { id: "comp-1", habit_id: "h1", completion_type: "quick" },
      error: null,
    });
    const res = await POST(
      makeRequest({ habitId: "h1", type: "quick" }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("comp-1");
  });

  it("passes correct fields to insert_completion RPC", async () => {
    await POST(
      makeRequest({
        habitId: "h1",
        type: "photo",
        evidenceUrl: "https://example.com/photo.jpg",
        notes: "Done!",
      }),
    );
    expect(mockRpc).toHaveBeenCalledWith("insert_completion", {
      p_habit_id: "h1",
      p_completion_type: "photo",
      p_evidence_url: "https://example.com/photo.jpg",
      p_notes: "Done!",
    });
  });

  it("returns 500 when Supabase insert fails", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "DB error", code: "PGRST000" },
    });
    const res = await POST(makeRequest({ habitId: "h1", type: "quick" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Failed to save completion");
  });

  it("omits evidence_url and notes when not provided, so the SQL defaults apply", async () => {
    // `insert_completion` declares both as `TEXT DEFAULT NULL`
    // (supabase/migrations/004_functions.sql), and the generated types mark
    // them optional. Leaving them undefined drops the keys from the JSON body,
    // which is how PostgREST is told to use the default — equivalent to NULL
    // here, and the type-correct way to express "not provided".
    await POST(makeRequest({ habitId: "h1", type: "quick" }));
    expect(mockRpc).toHaveBeenCalledWith(
      "insert_completion",
      expect.objectContaining({
        p_evidence_url: undefined,
        p_notes: undefined,
      }),
    );
  });

  describe("rain checks", () => {
    it("accepts a rain check with a reason and a note", async () => {
      const res = await POST(
        makeRequest({
          habitId: "h1",
          type: "rain_check",
          rainCheckReason: "sick",
          notes: "Back on it tomorrow",
        }),
      );
      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalledWith(
        "insert_completion",
        expect.objectContaining({
          p_completion_type: "rain_check",
          p_rain_check_reason: "sick",
          p_notes: "Back on it tomorrow",
        }),
      );
    });

    it("accepts a bare rain check — both the reason and the note are optional", async () => {
      const res = await POST(makeRequest({ habitId: "h1", type: "rain_check" }));
      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalledWith(
        "insert_completion",
        expect.objectContaining({
          p_completion_type: "rain_check",
          p_rain_check_reason: undefined,
        }),
      );
    });

    it("rejects an unknown reason", async () => {
      const res = await POST(
        makeRequest({
          habitId: "h1",
          type: "rain_check",
          rainCheckReason: "hungover",
        }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects a reason attached to a real completion", async () => {
      // The DB CHECK constraint would reject this too; failing at the edge
      // keeps the error legible instead of surfacing as a 500.
      const res = await POST(
        makeRequest({ habitId: "h1", type: "quick", rainCheckReason: "sick" }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("names rain_check among the valid types when the type is bad", async () => {
      const res = await POST(makeRequest({ habitId: "h1", type: "nope" }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("rain_check");
    });

    it("accepts a moved rain check", async () => {
      const res = await POST(
        makeRequest({
          habitId: "h1",
          type: "rain_check",
          rainCheckReason: "busy",
          rainCheckMovedTo: "2025-06-19",
        }),
      );
      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalledWith(
        "insert_completion",
        expect.objectContaining({
          p_completion_type: "rain_check",
          p_rain_check_moved_to: "2025-06-19",
        }),
      );
    });

    it("rejects a malformed moved-to day", async () => {
      // How far ahead a move may sit is chk_rain_check_moved_to's business —
      // the route only insists on a date key.
      const res = await POST(
        makeRequest({
          habitId: "h1",
          type: "rain_check",
          rainCheckMovedTo: "next Thursday",
        }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("rejects a moved-to day attached to a real completion", async () => {
      const res = await POST(
        makeRequest({
          habitId: "h1",
          type: "quick",
          rainCheckMovedTo: "2025-06-19",
        }),
      );
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it("carries the reason through a batch sync", async () => {
      mockRpc.mockResolvedValue({ data: [{ id: "comp-1" }], error: null });
      const res = await POST(
        makeRequest([
          { habitId: "h1", type: "rain_check", rainCheckReason: "travel" },
        ]),
      );
      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalledWith("insert_completions_batch", {
        p_items: [
          expect.objectContaining({
            completion_type: "rain_check",
            rain_check_reason: "travel",
          }),
        ],
      });
    });

    it("carries a moved-to day through a batch sync", async () => {
      mockRpc.mockResolvedValue({ data: [{ id: "comp-1" }], error: null });
      const res = await POST(
        makeRequest([
          {
            habitId: "h1",
            type: "rain_check",
            rainCheckMovedTo: "2025-06-19",
          },
        ]),
      );
      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalledWith("insert_completions_batch", {
        p_items: [
          expect.objectContaining({
            completion_type: "rain_check",
            rain_check_moved_to: "2025-06-19",
          }),
        ],
      });
    });
  });
});
