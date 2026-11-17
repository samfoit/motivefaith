import { describe, it, expect } from "vitest";
import {
  WAVE_BAR_SECONDS,
  extendWave,
  finishedBars,
  isFlatWave,
  newVoiceWave,
  waveFromSamples,
  waveLevel,
  wavePeak,
} from "@/lib/utils/voice-wave";

/** Peaks whose bar heights come out as round numbers: an eighth and a sixty-fourth. */
const LOUD = 1 / 16;
const QUIET = 1 / 256;
const round = (n: number) => Number(n.toFixed(3));

describe("voice wave", () => {
  it("takes the loudest sample either side of zero as the peak", () => {
    expect(wavePeak(new Float32Array([0.1, -0.5, 0.3]))).toBe(0.5);
    expect(wavePeak(new Float32Array(8))).toBe(0);
  });

  it("lifts quiet speech so it can be seen, and never passes full height", () => {
    expect(waveLevel(0)).toBe(0);
    expect(waveLevel(1 / 256)).toBeCloseTo(1 / 64);
    expect(waveLevel(1 / 16)).toBeCloseTo(1 / 8);
    expect(waveLevel(1)).toBe(1);
    expect(waveLevel(4)).toBe(1);
  });

  it("finishes a bar each time the take passes one, at the loudest it heard", () => {
    const wave = newVoiceWave();
    // Three frames inside the first bar: quiet, loud, quiet.
    extendWave(wave, QUIET, WAVE_BAR_SECONDS / 4);
    extendWave(wave, LOUD, WAVE_BAR_SECONDS / 4);
    extendWave(wave, QUIET, WAVE_BAR_SECONDS / 4);
    expect(wave.bars).toEqual([]);
    expect(wave.forming).toBeCloseTo(1 / 8);

    extendWave(wave, QUIET, WAVE_BAR_SECONDS / 2);
    expect(wave.bars).toHaveLength(1);
    expect(wave.bars[0]).toBeCloseTo(1 / 8);
    expect(wave.position).toBeCloseTo(1.25);
    // The next bar starts from what is being heard now, not from the last one.
    expect(wave.forming).toBeCloseTo(1 / 64);
  });

  it("keeps time when frames stop coming, as in a hidden tab", () => {
    const wave = newVoiceWave();
    extendWave(wave, 0.04, 1);
    expect(wave.bars).toHaveLength(Math.floor(1 / WAVE_BAR_SECONDS));
    expect(wave.position).toBeCloseTo(1 / WAVE_BAR_SECONDS);
  });

  it("hands over the bar still filling when the take ends mid-bar", () => {
    const wave = newVoiceWave();
    extendWave(wave, LOUD, WAVE_BAR_SECONDS * 1.5);
    expect(finishedBars(wave).map(round)).toEqual([0.125, 0.125]);
    // A copy: the review's bars do not grow with the next take.
    expect(finishedBars(wave)).not.toBe(wave.bars);
  });

  it("tells a meter that heard nothing from a quiet room", () => {
    expect(isFlatWave([0, 0, 0])).toBe(true);
    expect(isFlatWave([])).toBe(true);
    expect(isFlatWave(null)).toBe(true);
    expect(isFlatWave([0, 0.03, 0])).toBe(false);
  });

  it("cuts decoded audio into the same bars a live take draws", () => {
    const rate = 1000;
    const samples = new Float32Array(200);
    samples.fill(LOUD, 0, 80);
    samples.fill(QUIET, 80, 160);
    expect(waveFromSamples(samples, rate).map(round)).toEqual([0.125, 0.016, 0]);
  });
});
