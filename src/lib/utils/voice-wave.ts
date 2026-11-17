/**
 * A voice take's loudness over time: the bars of the waveform that scrolls
 * past while the take records, and scrolls past again while it plays back.
 */

/** How much of the take one bar stands for. */
export const WAVE_BAR_SECONDS = 0.08;

export interface VoiceWave {
  /** Finished bars, oldest first, each 0 (silence) to 1 (full scale). */
  bars: number[];
  /** How far the take has got, in bars. */
  position: number;
  /** The bar still filling at `position`. */
  forming: number;
}

export function newVoiceWave(): VoiceWave {
  return { bars: [], position: 0, forming: 0 };
}

/** The loudest sample in a stretch of audio, as a share of full scale. */
export function wavePeak(samples: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] < 0 ? -samples[i] : samples[i];
    if (s > peak) peak = s;
  }
  return peak;
}

/**
 * A bar's height for a peak. A little under linear (the 3/4 power), so the
 * loud and soft syllables of ordinary speech stay clearly different heights
 * while quiet speech still stands up off the line, and the room between
 * words shows as a ripple rather than nothing.
 */
export function waveLevel(peak: number): number {
  return Math.min(1, Math.pow(Math.max(0, peak), 0.75));
}

/**
 * Moves a take on by `seconds` in which the mic's loudest was `peak`,
 * finishing each bar the take has now passed.
 */
export function extendWave(wave: VoiceWave, peak: number, seconds: number): void {
  const level = waveLevel(peak);
  wave.forming = Math.max(wave.forming, level);
  wave.position += Math.max(0, seconds) / WAVE_BAR_SECONDS;
  while (wave.bars.length < Math.floor(wave.position)) {
    wave.bars.push(wave.forming);
    wave.forming = level;
  }
}

/** A take's bars as they stand, the one still filling included. */
export function finishedBars(wave: VoiceWave): number[] {
  return wave.position > wave.bars.length ? [...wave.bars, wave.forming] : [...wave.bars];
}

/** True when a wave heard nothing at all: a dead meter, not a quiet room. */
export function isFlatWave(bars: readonly number[] | null | undefined): boolean {
  return !bars || bars.every((b) => b === 0);
}

/** The bars of audio that has already been decoded. */
export function waveFromSamples(samples: Float32Array, sampleRate: number): number[] {
  const perBar = Math.max(1, Math.round(sampleRate * WAVE_BAR_SECONDS));
  const bars: number[] = [];
  for (let from = 0; from < samples.length; from += perBar) {
    bars.push(waveLevel(wavePeak(samples.subarray(from, from + perBar))));
  }
  return bars;
}

/**
 * Works a take's bars out from the recording itself, for a take the meter
 * never heard (no Web Audio, or an analyser reading silence on an iPhone) or
 * one recorded before this screen was opened. Null when the browser cannot
 * decode the file.
 *
 * Read from the Blob, never fetched from its blob: URL, which the site's
 * `connect-src` does not allow. An offline context, because it needs no tap
 * to start and leaves the phone's audio session alone.
 */
export async function decodeTakeWave(blob: Blob): Promise<number[] | null> {
  const Offline =
    typeof OfflineAudioContext !== "undefined"
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
  if (!Offline) return null;
  try {
    const ctx = new Offline(1, 1, 44100);
    const data = await blob.arrayBuffer();
    // The callback form as well as the promise: older Safari has only it.
    const audio = await new Promise<AudioBuffer>((resolve, reject) => {
      const decoding = ctx.decodeAudioData(data, resolve, reject);
      if (decoding) decoding.then(resolve, reject);
    });
    return waveFromSamples(audio.getChannelData(0), audio.sampleRate);
  } catch {
    return null;
  }
}
