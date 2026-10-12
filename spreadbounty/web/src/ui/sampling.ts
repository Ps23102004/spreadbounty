import type { SampleRecord } from "../../../src/core/epoch";

/**
 * The draw for one sample, redone from the epoch file (the same rule as pickSampleBlocks in src/core/score.ts):
 * the window closes at `closer`, and the sample is window start + (hash of the closing block mod sampleEvery).
 */
export function explainSample(s: Pick<SampleRecord, "block" | "closer" | "closerHash">, every: number) {
  const start = s.closer - every + 1;
  const offset = Number(BigInt(s.closerHash) % BigInt(every));
  return { start, offset, agrees: start + offset === s.block };
}
