import type { Order } from "../../../src/core/book";
import { scoreSample } from "../../../src/core/score";

const SIZE = 10n ** 12n; // large enough that the scorer's integer division costs nothing visible

/**
 * Score weight of one quote at `price` against `mid` (both raw contract units), asked of the production
 * scorer, not a copy of its formula. `twoSided`: the quote plus a matching one on the other side at the same
 * distance (1 at the centre, 0 at or past the band edge). `oneSided`: the quote alone, which the scorer cuts to a third.
 */
export function quoteWeight(price: bigint, mid: bigint, bandBps: number): { twoSided: number; oneSided: number } {
  const order = (id: number, p: bigint, isBuy: boolean): Order => ({ id, owner: "probe", price: p, size: SIZE, isBuy, createdBlock: 0 });
  const isBuy = price < mid;
  const one = scoreSample([order(1, price, isBuy)], 1, mid, bandBps, 0).get("probe") ?? 0n;
  const two = scoreSample([order(1, price, isBuy), order(2, 2n * mid - price, !isBuy)], 1, mid, bandBps, 0).get("probe") ?? 0n;
  return { twoSided: Number(two) / Number(SIZE), oneSided: Number(one) / Number(SIZE) };
}
