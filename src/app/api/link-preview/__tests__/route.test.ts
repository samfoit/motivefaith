import { describe, it, expect, vi, beforeEach } from "vitest";

const authed = vi.fn(() => true);

vi.mock("@/lib/utils/api-helpers", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/utils/api-helpers")>();
  return {
    ...mod,
    requireAuthUser: vi.fn(async () =>
      authed()
        ? { ok: true as const, user: { id: "user-1" }, supabase: {} }
        : { ok: false as const, response: mod.jsonResponse({ error: "Unauthorized" }, { status: 401 }) },
    ),
  };
});

const getLinkPreview = vi.fn();
const guardedGet = vi.fn();

vi.mock("@/lib/link-preview/fetch", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/link-preview/fetch")>();
  return {
    ...mod,
    getLinkPreview: (url: string) => getLinkPreview(url),
    guardedGet: (url: string, accept: string) => guardedGet(url, accept),
  };
});

const { GET } = await import("../route");
const { GET: GET_IMAGE } = await import("../image/route");

const ask = (url: string | null, path = "/api/link-preview") =>
  new Request(`http://localhost:3000${path}${url === null ? "" : `?url=${encodeURIComponent(url)}`}`);

const PREVIEW = {
  url: "https://example.com/post",
  title: "A post",
  description: "About it",
  siteName: "Example",
  image: "https://cdn.example.com/og.png",
  largeImage: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  authed.mockReturnValue(true);
});

describe("GET /api/link-preview", () => {
  it("is for signed-in people only", async () => {
    authed.mockReturnValue(false);
    const res = await GET(ask("https://example.com/post"));
    expect(res.status).toBe(401);
    expect(getLinkPreview).not.toHaveBeenCalled();
  });

  it("needs a url", async () => {
    expect((await GET(ask(null))).status).toBe(400);
  });

  it("answers null without fetching an address it may not reach", async () => {
    const res = await GET(ask("http://169.254.169.254/latest/meta-data/"));
    expect(await res.json()).toEqual({ preview: null });
    expect(getLinkPreview).not.toHaveBeenCalled();
  });

  it("hands back the preview with the picture behind our own route", async () => {
    getLinkPreview.mockResolvedValue(PREVIEW);
    const res = await GET(ask(PREVIEW.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=86400");
    const body = await res.json();
    expect(body.preview).toEqual({
      ...PREVIEW,
      image: `/api/link-preview/image?url=${encodeURIComponent(PREVIEW.url)}`,
    });
    expect(JSON.stringify(body)).not.toContain("cdn.example.com");
  });

  it("answers null when the page has nothing to show", async () => {
    getLinkPreview.mockResolvedValue(null);
    const res = await GET(ask("https://example.com/empty"));
    expect(await res.json()).toEqual({ preview: null });
  });
});

function imageResponse(contentType: string, body: Buffer, truncated = false) {
  return {
    url: PREVIEW.image,
    contentType,
    charset: null,
    read: vi.fn(async () => ({ body, truncated })),
    discard: vi.fn(),
  };
}

describe("GET /api/link-preview/image", () => {
  const path = "/api/link-preview/image";

  it("is for signed-in people only", async () => {
    authed.mockReturnValue(false);
    expect((await GET_IMAGE(ask(PREVIEW.url, path))).status).toBe(401);
  });

  it("fetches only the picture the page names", async () => {
    getLinkPreview.mockResolvedValue(PREVIEW);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    guardedGet.mockResolvedValue(imageResponse("image/png", png));

    const res = await GET_IMAGE(ask(PREVIEW.url, path));
    expect(guardedGet).toHaveBeenCalledWith(PREVIEW.image, expect.any(String));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
  });

  it("refuses an SVG", async () => {
    getLinkPreview.mockResolvedValue(PREVIEW);
    const svg = imageResponse("image/svg+xml", Buffer.from("<svg onload=alert(1)>"));
    guardedGet.mockResolvedValue(svg);
    expect((await GET_IMAGE(ask(PREVIEW.url, path))).status).toBe(404);
    expect(svg.discard).toHaveBeenCalled();
  });

  it("refuses a picture too large to pass on", async () => {
    getLinkPreview.mockResolvedValue(PREVIEW);
    guardedGet.mockResolvedValue(imageResponse("image/jpeg", Buffer.alloc(10), true));
    expect((await GET_IMAGE(ask(PREVIEW.url, path))).status).toBe(404);
  });

  it("is a 404 when the page has no picture", async () => {
    getLinkPreview.mockResolvedValue({ ...PREVIEW, image: null });
    expect((await GET_IMAGE(ask(PREVIEW.url, path))).status).toBe(404);
    expect(guardedGet).not.toHaveBeenCalled();
  });

  it("is a 404 when the picture can't be fetched", async () => {
    getLinkPreview.mockResolvedValue(PREVIEW);
    guardedGet.mockRejectedValue(new Error("HTTP 500"));
    expect((await GET_IMAGE(ask(PREVIEW.url, path))).status).toBe(404);
  });
});
