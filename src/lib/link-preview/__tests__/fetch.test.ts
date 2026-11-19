import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import http from "node:http";
import dns from "node:dns";
import { PassThrough } from "node:stream";
import type { AddressInfo } from "node:net";
import {
  BlockedUrlError,
  checkUrl,
  clearLinkPreviewCache,
  getLinkPreview,
  guardedGet,
  isBlockedAddress,
  previewKey,
  readLimited,
  requestOnce,
} from "../fetch";

/** One request with the guarded lookup but no URL check, for an odd port. */
async function guardedGetUnchecked(url: string) {
  const res = await requestOnce(new URL(url), "*/*", AbortSignal.timeout(2000));
  res.destroy();
  return res;
}

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::a00:1",
    "not an ip",
  ])("refuses %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "104.16.1.1", "2606:4700::1111"])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });
});

describe("checkUrl", () => {
  it.each([
    "ftp://example.com/",
    "file:///etc/passwd",
    "http://127.0.0.1/",
    "http://2130706433/", // 127.0.0.1 written as a number
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost/",
    "http://intranet/",
    "https://example.com:8080/",
    "https://user:pass@example.com/",
    "not a url",
  ])("refuses %s", (url) => {
    expect(() => checkUrl(url)).toThrow(BlockedUrlError);
  });

  it.each(["https://example.com/", "http://example.com:80/a", "https://8.8.8.8/"])("allows %s", (url) => {
    expect(checkUrl(url).href).toBeTruthy();
  });
});

describe("a server on this machine", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<head><meta property="og:title" content="internal secret"></head>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => clearLinkPreviewCache());

  afterEach(() => vi.restoreAllMocks());

  it("is up, so a refusal below is the guard's doing", async () => {
    const body = await new Promise<string>((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/`, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }).on("error", reject);
    });
    expect(body).toContain("internal secret");
  });

  it("is refused by address", async () => {
    await expect(guardedGet(`http://127.0.0.1:${port}/`, "*/*")).rejects.toThrow(BlockedUrlError);
    await expect(getLinkPreview(`http://127.0.0.1:${port}/`)).resolves.toBeNull();
  });

  it("is refused through a public-looking name that resolves to it", async () => {
    // A name passes checkUrl; the lookup at connect time must stop it. The
    // port is the local server's, so only the guard stands in the way.
    vi.spyOn(dns, "lookup").mockImplementation(((
      _host: string,
      _opts: unknown,
      cb: (err: null, addresses: { address: string; family: number }[]) => void,
    ) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as unknown as typeof dns.lookup);
    // checkUrl only allows 80/443, so go below it to aim at the test port.
    await expect(guardedGetUnchecked(`http://evil.example:${port}/`)).rejects.toThrow(/private address/);
  });
});

describe("previewKey", () => {
  it("drops the fragment", () => {
    expect(previewKey("https://a.com/p?q=1#section")).toBe("https://a.com/p?q=1");
  });
});

describe("readLimited", () => {
  function stream(...chunks: string[]) {
    const s = new PassThrough();
    for (const c of chunks) s.write(Buffer.from(c));
    s.end();
    return s;
  }
  const source = () => ({ destroy: vi.fn() }) as unknown as http.IncomingMessage;

  it("reads to the end under the limit", async () => {
    const r = await readLimited(stream("ab", "cd"), source(), 10);
    expect(r).toEqual({ body: Buffer.from("abcd"), truncated: false });
  });

  it("stops at the limit", async () => {
    const src = source();
    const r = await readLimited(stream("abc", "def"), src, 4);
    expect(r).toEqual({ body: Buffer.from("abcd"), truncated: true });
    expect(src.destroy).toHaveBeenCalled();
  });

  it("stops once the marker has arrived, even split across chunks", async () => {
    const src = source();
    const r = await readLimited(stream("<head>x</he", "ad><body>", "never read"), src, 1000, Buffer.from("</head>"));
    expect(r.body.toString()).toBe("<head>x</head><body>");
    expect(src.destroy).toHaveBeenCalled();
  });
});
