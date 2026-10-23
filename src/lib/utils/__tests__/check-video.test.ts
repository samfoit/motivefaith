import { describe, it, expect } from "vitest";
import { checkVideo, isUploadTooLarge, readVideoDuration } from "../check-video";

// ---------------------------------------------------------------------------
// MP4 / QuickTime files, built box by box
// ---------------------------------------------------------------------------

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** One box: a 32-bit size, the type, then the body. */
function box(type: string, ...body: Uint8Array[]): Uint8Array {
  const content = concat(...body);
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, 8 + content.length);
  head.set(ascii(type), 4);
  return concat(head, content);
}

/** A box with its size in the 64-bit field, as for media over 4 GB. */
function largeBox(type: string, body: Uint8Array): Uint8Array {
  const head = new Uint8Array(16);
  const view = new DataView(head.buffer);
  view.setUint32(0, 1);
  head.set(ascii(type), 4);
  view.setUint32(12, 16 + body.length); // the high half stays 0
  return concat(head, body);
}

/** A version 0 movie header: 32-bit times and duration. */
function mvhd(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(100);
  const view = new DataView(body.buffer);
  view.setUint32(12, timescale);
  view.setUint32(16, duration);
  return box("mvhd", body);
}

/** A version 1 movie header: 64-bit times and duration. */
function mvhd64(timescale: number, duration: number): Uint8Array {
  const body = new Uint8Array(112);
  const view = new DataView(body.buffer);
  view.setUint8(0, 1);
  view.setUint32(20, timescale);
  view.setUint32(24, Math.floor(duration / 2 ** 32));
  view.setUint32(28, duration % 2 ** 32);
  return box("mvhd", body);
}

/**
 * Laid out the way a phone writes a recording: the media first and the index
 * (moov) after it, with the movie header after a track.
 */
function phoneVideo(header: Uint8Array, { media = box("mdat", new Uint8Array(4096)) } = {}) {
  const bytes = concat(
    box("ftyp", ascii("qt  "), new Uint8Array(4), ascii("qt  ")),
    box("wide"),
    media,
    box("moov", box("trak", box("tkhd", new Uint8Array(84))), header),
  );
  return new File([bytes], "IMG_0001.MOV", { type: "video/quicktime" });
}

/** A video `seconds` long, at the 600 ticks a second iPhones use. */
function videoOf(seconds: number) {
  return phoneVideo(mvhd(600, Math.round(seconds * 600)));
}

/** Pretend to a size without holding that many bytes in a test. */
function sized<T extends Blob>(file: T, bytes: number): T {
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

const MB = 1024 * 1024;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("readVideoDuration", () => {
  it("reads a phone video's length from the index after its media", async () => {
    expect(await readVideoDuration(videoOf(42))).toBe(42);
  });

  it("reads a 64-bit movie header", async () => {
    const file = phoneVideo(mvhd64(90_000, 90_000 * 20.5));
    expect(await readVideoDuration(file)).toBe(20.5);
  });

  it("steps over media whose size is in the 64-bit field", async () => {
    const file = phoneVideo(mvhd(600, 600 * 9), {
      media: largeBox("mdat", new Uint8Array(2048)),
    });
    expect(await readVideoDuration(file)).toBe(9);
  });

  it("has no length for a file that isn't MP4 or QuickTime", async () => {
    // A WebM's EBML header: read as a box, its size runs past the file.
    const webm = new File(
      [Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01])],
      "clip.webm",
      { type: "video/webm" },
    );
    expect(await readVideoDuration(webm)).toBeNull();
    expect(await readVideoDuration(new File([], "empty.mov"))).toBeNull();
  });

  it("has no length where the header says it doesn't know one", async () => {
    expect(await readVideoDuration(phoneVideo(mvhd(600, 0xffffffff)))).toBeNull();
    expect(await readVideoDuration(phoneVideo(mvhd(0, 600)))).toBeNull();
  });
});

describe("checkVideo", () => {
  it("lets a short video through", async () => {
    expect(await checkVideo(videoOf(12))).toBeNull();
  });

  it("turns away a video longer than the camera's own limit, saying how long it is", async () => {
    expect(await checkVideo(videoOf(42))).toBe(
      "Videos can be up to 15 seconds. This one is 42.",
    );
  });

  it("measures the length as it would be shown, to the nearest second", async () => {
    expect(await checkVideo(videoOf(15.4))).toBeNull();
    expect(await checkVideo(videoOf(15.6))).toBe(
      "Videos can be up to 15 seconds. This one is 16.",
    );
  });

  it("turns away a short video over the size the storage bucket takes", async () => {
    expect(await checkVideo(sized(videoOf(8), 98 * MB + 1))).toBe(
      "Videos can be up to 50 MB. This one is 99 MB — try a shorter clip.",
    );
    expect(await checkVideo(sized(videoOf(8), 50 * MB))).toBeNull();
  });

  it("holds a video of unknown length to the size limit alone", async () => {
    const webm = () => new File(["webm"], "clip.webm", { type: "video/webm" });
    expect(await checkVideo(webm())).toBeNull();
    expect(await checkVideo(sized(webm(), 60 * MB))).toMatch(/^Videos can be up to 50 MB/);
  });

  it("turns away a video type the bucket won't store", async () => {
    const m4v = new File(["v"], "clip.m4v", { type: "video/x-m4v" });
    expect(await checkVideo(m4v)).toBe("Unsupported video type. Use MP4, MOV, or WebM.");
  });
});

describe("isUploadTooLarge", () => {
  it("recognizes the storage server's refusal of an oversized file", () => {
    // What supabase-js rejects with when the bucket's size limit is hit.
    expect(isUploadTooLarge({ statusCode: "413", message: "Payload too large" })).toBe(true);
    expect(isUploadTooLarge({ statusCode: 413 })).toBe(true);
  });

  it("leaves every other failure alone", () => {
    expect(isUploadTooLarge({ statusCode: "400" })).toBe(false);
    expect(isUploadTooLarge(new Error("network down"))).toBe(false);
    expect(isUploadTooLarge(null)).toBe(false);
  });
});
