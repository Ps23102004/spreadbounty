/**
 * The maker bot's brain: one pure function from "what the book and my orders look like" to "what to cancel
 * and what to place". No I/O and no AI, so the simulator and the live runner make the same decisions,
 * and tests can pin them down.
 *
 * What the Spreadbounty scorer rewards, and therefore what this does:
 *  - orders inside the band, weighted ((band - dist) / band)^2 * size: quote near the centre, not at the edge;
 *  - both sides (one-sided earns a third): keep a bid AND an ask up;
 *  - only orders that have rested >= minRest blocks: every requote restarts that clock, so leave good orders alone
 *    and requote only when one drifts out of the band or far from where it should be (hysteresis).
 * Guards: post-only prices that never cross the rest of the book, an inventory limit per side, and a
 * peg guard that pulls all quotes when the market moves away from a fixed reference price.
 */

export interface BotParams {
  /** where to quote, as a fraction of the band from the centre (0.35 = 35% of the way to the edge) */
  offsetFrac: number;
  /** requote a side when its order is further than this fraction of the band from the centre */
  maxDistFrac: number;
  /** ...or when it is further than this fraction of the band from where a fresh quote would go */
  hysteresisFrac: number;
  /** requote anything older than this many blocks (0 = never); a naive bot sets this, ours doesn't */
  maxAgeBlocks: number;
  /** order size per side, in base-token raw units (sizePrecision) */
  sizeRaw: bigint;
  /** stop adding to a side once the net position from fills exceeds this, base raw units (0 = no limit) */
  maxInventoryRaw: bigint;
  /** with a fixed reference price: pull every quote if the rest of the book's mid is this many bps away */
  pegGuardBps: number;
}

export const DEFAULT_PARAMS: Omit<BotParams, "sizeRaw" | "maxInventoryRaw"> = {
  offsetFrac: 0.35,
  maxDistFrac: 0.85,
  hysteresisFrac: 0.4,
  maxAgeBlocks: 0,
  pegGuardBps: 30,
};

export interface MyOrder { id: number; isBuy: boolean; price: bigint; size: bigint; createdBlock: number }

export interface Market { bandBps: number; minRestBlocks: number; tick: bigint; minSize: bigint }

export interface BotInput {
  block: number;
  /** the price the campaign scores against: its fixed reference, or null to use the book mid */
  refPrice: bigint | null;
  /** best bid / ask of everyone except this bot (raw price units) */
  othersBid: bigint | null;
  othersAsk: bigint | null;
  mine: MyOrder[];
  /** net base bought (+) or sold (-) through fills since the bot started, raw size units */
  inventoryRaw: bigint;
  /** campaign start: orders created before this block never score, so they get replaced */
  countsFrom?: number;
}

export type Action = { kind: "cancel"; ids: number[] } | { kind: "place"; isBuy: boolean; price: bigint; size: bigint };
export interface Decision { actions: Action[]; centre: bigint | null; notes: string[] }

const BPS = 10_000n;
const SCALE = 1_000_000n;
const fx = (x: number) => BigInt(Math.round(x * Number(SCALE)));

/** distance of a price from the centre, in bps * SCALE (same integer maths as the scorer) */
export const distBpsScaled = (price: bigint, centre: bigint) => ((price > centre ? price - centre : centre - price) * BPS * SCALE) / centre;

export function decide(input: BotInput, m: Market, p: BotParams): Decision {
  const notes: string[] = [];
  const othersMid = input.othersBid !== null && input.othersAsk !== null ? (input.othersBid + input.othersAsk) / 2n : null;
  const centre = input.refPrice ?? othersMid;
  const cancelAll = (why: string): Decision => {
    notes.push(why);
    return { actions: input.mine.length ? [{ kind: "cancel", ids: input.mine.map((o) => o.id) }] : [], centre, notes };
  };

  if (centre === null) return { actions: [], centre, notes: ["no centre price yet (no fixed reference and no two-sided book): holding"] };
  if (input.refPrice !== null && othersMid !== null) {
    const off = distBpsScaled(othersMid, input.refPrice);
    if (off > BigInt(p.pegGuardBps) * SCALE) return cancelAll(`peg guard: book mid is ${(Number(off) / Number(SCALE)).toFixed(1)} bps from the reference, quotes pulled`);
  }

  const band = BigInt(m.bandBps) * SCALE;
  const offset = (band * fx(p.offsetFrac)) / SCALE; // bps * SCALE
  const priceAt = (isBuy: boolean) => {
    const delta = (centre * offset) / (BPS * SCALE);
    let px = isBuy ? centre - delta : centre + delta;
    px = isBuy ? (px / m.tick) * m.tick : ((px + m.tick - 1n) / m.tick) * m.tick; // round away from the centre
    // post-only: never cross what's already resting on the other side
    if (isBuy && input.othersAsk !== null && px >= input.othersAsk) px = ((input.othersAsk - m.tick) / m.tick) * m.tick;
    if (!isBuy && input.othersBid !== null && px <= input.othersBid) px = ((input.othersBid + m.tick) / m.tick) * m.tick;
    return px;
  };

  const actions: Action[] = [];
  const cancel: number[] = [];
  for (const isBuy of [true, false]) {
    const side = input.mine.filter((o) => o.isBuy === isBuy).sort((a, b) => a.createdBlock - b.createdBlock);
    // inventory limit: buying more base (bid) is blocked when long, selling (ask) when short
    const blocked = p.maxInventoryRaw > 0n && (isBuy ? input.inventoryRaw >= p.maxInventoryRaw : -input.inventoryRaw >= p.maxInventoryRaw);
    if (blocked) {
      if (side.length) cancel.push(...side.map((o) => o.id));
      notes.push(`${isBuy ? "bid" : "ask"} off: inventory limit`);
      continue;
    }
    const want = priceAt(isBuy);
    const wantDist = distBpsScaled(want, centre);
    if (wantDist > band) {
      if (side.length) cancel.push(...side.map((o) => o.id));
      notes.push(`${isBuy ? "bid" : "ask"} off: the book leaves no room inside the band`);
      continue;
    }
    const keep = side[side.length - 1]; // the newest one; extras are cancelled
    if (side.length > 1) cancel.push(...side.slice(0, -1).map((o) => o.id));
    if (keep) {
      const why =
        distBpsScaled(keep.price, centre) > (band * fx(p.maxDistFrac)) / SCALE ? "drifted to the band edge"
        : distBpsScaled(keep.price, want) > (band * fx(p.hysteresisFrac)) / SCALE ? "far from target"
        : input.countsFrom !== undefined && keep.createdBlock < input.countsFrom && input.block >= input.countsFrom ? "placed before the campaign started"
        : p.maxAgeBlocks > 0 && input.block - keep.createdBlock >= p.maxAgeBlocks ? "max age"
        : keep.size < m.minSize ? "partly filled below min size"
        : (isBuy && input.othersAsk !== null && keep.price >= input.othersAsk) || (!isBuy && input.othersBid !== null && keep.price <= input.othersBid) ? "crossed"
        : null;
      if (!why) continue; // a good resting order keeps earning; leave it alone
      cancel.push(keep.id);
      notes.push(`requote ${isBuy ? "bid" : "ask"}: ${why}`);
    }
    const size = p.sizeRaw < m.minSize ? m.minSize : p.sizeRaw;
    actions.push({ kind: "place", isBuy, price: want, size });
  }
  if (cancel.length) actions.unshift({ kind: "cancel", ids: [...new Set(cancel)] });
  return { actions, centre, notes };
}
