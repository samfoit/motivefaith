/** What a voice readout shows: a short label and what it currently reads. */
export type VoiceReadings = Record<string, string>;

/** The loudest an analyser has been since its caller started asking. */
export interface LevelMemory {
  loudest: number;
}

export function newLevelMemory(): LevelMemory {
  return { loudest: -Infinity };
}

/**
 * How loud an analyser is hearing its source right now, in dB of full scale,
 * and the loudest it has been: a readout only looks a few times a second,
 * and speech is full of gaps.
 *
 * "all zeros" is a source that has handed over nothing at all, which a quiet
 * room never is: a live mic idles around -60 dB.
 */
export function analyserLevel(analyser: AnalyserNode | null, memory: LevelMemory): string {
  if (!analyser) return "no analyser";
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  const now = rms > 0 ? Math.round(20 * Math.log10(rms)) : -Infinity;
  memory.loudest = Math.max(memory.loudest, now);
  if (memory.loudest === -Infinity) return "all zeros";
  return `${now === -Infinity ? "zeros" : `${now} dB`}, loudest ${memory.loudest} dB`;
}
