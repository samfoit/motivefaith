import { describe, it, expect, vi, afterEach } from "vitest";
import { getSupportedAudioMimeType } from "../audio-recorder";

/** A browser whose recorder takes exactly these types. */
function recorderTaking(...types: string[]) {
  vi.stubGlobal("MediaRecorder", { isTypeSupported: (t: string) => types.includes(t) });
}

function vendor(name: string) {
  vi.spyOn(navigator, "vendor", "get").mockReturnValue(name);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getSupportedAudioMimeType", () => {
  // Since iOS 18.4 Safari records WebM too, but plays it through a player
  // the review's meter can't read and that knows no length for the file.
  it("records MP4 on an iPhone, though its recorder also takes WebM", () => {
    vendor("Apple Computer, Inc.");
    recorderTaking("audio/webm;codecs=opus", "audio/webm", "audio/mp4");

    expect(getSupportedAudioMimeType()).toEqual({ mimeType: "audio/mp4", extension: "m4a" });
  });

  it("records WebM in Chrome, though its recorder also takes MP4", () => {
    vendor("Google Inc.");
    recorderTaking("audio/webm;codecs=opus", "audio/webm", "audio/mp4");

    expect(getSupportedAudioMimeType()).toEqual({
      mimeType: "audio/webm;codecs=opus",
      extension: "webm",
    });
  });

  it("falls back to whatever the recorder does take", () => {
    vendor("Apple Computer, Inc.");
    recorderTaking("audio/webm");
    expect(getSupportedAudioMimeType()).toEqual({ mimeType: "audio/webm", extension: "webm" });

    vendor("");
    recorderTaking("audio/ogg;codecs=opus");
    expect(getSupportedAudioMimeType()).toEqual({
      mimeType: "audio/ogg;codecs=opus",
      extension: "ogg",
    });
  });

  it("has nothing to offer without a recorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(getSupportedAudioMimeType()).toBeNull();
  });
});
