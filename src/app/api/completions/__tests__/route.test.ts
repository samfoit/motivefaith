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

  it("defaults evidence_url and notes to null when not provided", async () => {
    await POST(makeRequest({ habitId: "h1", type: "quick" }));
    expect(mockRpc).toHaveBeenCalledWith(
      "insert_completion",
      expect.objectContaining({
        p_evidence_url: null,
        p_notes: null,
      }),
    );
  });
});
