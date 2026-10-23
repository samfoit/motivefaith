import { describe, it, expect, vi, afterEach } from "vitest";
import { getSupportedMimeType, getTranscodeMimeType } from "../media-recorder";

/** A browser whose recorder takes exactly these types. */
function recorderTaking(...types: string[]) {
  vi.stubGlobal("MediaRecorder", { isTypeSupported: (t: string) => types.includes(t) });
}

afterEach(() => vi.unstubAllGlobals());

describe("getTranscodeMimeType", () => {
  it("takes H.264 with AAC in MP4 where it can, which every phone plays", () => {
    recorderTaking(
      "video/mp4;codecs=avc1,mp4a.40.2",
      "video/mp4",
      "video/webm;codecs=vp9",
    );

    expect(getTranscodeMimeType()).toEqual({
      mimeType: "video/mp4;codecs=avc1,mp4a.40.2",
      extension: "mp4",
    });
  });

  it("takes WebM over an MP4 whose sound it can't name, as Chrome on Android without AAC offers", () => {
    recorderTaking("video/mp4", "video/mp4;codecs=avc1", "video/webm;codecs=vp9");

    expect(getTranscodeMimeType()).toEqual({
      mimeType: "video/webm;codecs=vp9",
      extension: "webm",
    });
  });

  it("falls back to a plain MP4 where nothing else records", () => {
    recorderTaking("video/mp4");

    expect(getTranscodeMimeType()).toEqual({ mimeType: "video/mp4", extension: "mp4" });
  });

  it("has nothing to offer without a recorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);

    expect(getTranscodeMimeType()).toBeNull();
  });
});

describe("getSupportedMimeType", () => {
  it("keeps the camera on WebM first, as before", () => {
    recorderTaking("video/mp4;codecs=avc1,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9");

    expect(getSupportedMimeType()).toEqual({
      mimeType: "video/webm;codecs=vp9",
      extension: "webm",
    });
  });
});
