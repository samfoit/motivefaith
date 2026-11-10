import { describe, it, expect } from "vitest";
import {
  AUDIO_BITS_PER_SECOND,
  MAX_VIDEO_DURATION_S,
  MAX_VIDEO_SIZE_MB,
  VIDEO_BITS_PER_SECOND,
} from "../limits";

describe("video limits", () => {
  /**
   * A recorder aims at its bitrate rather than holding to it, and a take that
   * comes out too big is only turned away once it has been recorded. So the
   * longest video has to fit with a fifth of the limit to spare.
   */
  it("fits a full-length video in the upload limit, with room to spare", () => {
    const bytesPerSecond = (VIDEO_BITS_PER_SECOND + AUDIO_BITS_PER_SECOND) / 8;
    const fullVideo = bytesPerSecond * MAX_VIDEO_DURATION_S;

    expect(fullVideo).toBeLessThan(0.8 * MAX_VIDEO_SIZE_MB * 1024 * 1024);
  });
});
