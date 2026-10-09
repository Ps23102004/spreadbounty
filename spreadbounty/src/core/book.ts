import { ethers } from "ethers";
import { ORDERBOOK_ABI } from "./abi";
import type { RawLog } from "./rpc";

export const obIface = new ethers.utils.Interface(ORDERBOOK_ABI);

export const BOOK_TOPICS = [
  "OrderCreated",
  "OrdersCanceled",
  "Trade",
  "FlipOrderCreated",
  "FlippedOrderCreated",
  "FlipOrderUpdated",
  "FlipOrdersCanceled",
].map((n) => obIface.getEventTopic(n));

/** A resting order in raw contract units: price in pricePrecision, size in sizePrecision. */
export interface Order {
  id: number;
  owner: string; // lowercase
  price: bigint;
  size: bigint;
  isBuy: boolean;
  createdBlock: number;
}

export type BookEvent =
  | { kind: "create"; block: number; order: Order }
  | { kind: "cancel"; block: number; ids: number[] }
  | { kind: "resize"; block: number; id: number; size: bigint }; // size = remaining; 0 removes

/** Decode Kuru OrderBook logs into book events. Unknown logs are skipped. */
export function decodeBookLogs(logs: RawLog[]): BookEvent[] {
  const out: BookEvent[] = [];
  for (const l of logs) {
    let ev: ethers.utils.LogDescription;
    try {
      ev = obIface.parseLog(l);
    } catch {
      continue;
    }
    const a = ev.args;
    const block = l.blockNumber;
    switch (ev.name) {
      case "OrderCreated":
        out.push({ kind: "create", block, order: { id: Number(a.orderId), owner: String(a.owner).toLowerCase(), price: BigInt(a.price.toString()), size: BigInt(a.size.toString()), isBuy: a.isBuy, createdBlock: block } });
        break;
      case "FlipOrderCreated":
      case "FlippedOrderCreated":
        out.push({ kind: "create", block, order: { id: Number(a.orderId), owner: String(a.owner).toLowerCase(), price: BigInt(a.price.toString()), size: BigInt(a.size.toString()), isBuy: a.isBuy, createdBlock: block } });
        break;
      case "OrdersCanceled":
        out.push({ kind: "cancel", block, ids: (a.orderId as ethers.BigNumber[]).map(Number) });
        break;
      case "FlipOrdersCanceled":
        out.push({ kind: "cancel", block, ids: (a.orderIds as ethers.BigNumber[]).map(Number) });
        break;
      case "Trade":
        // updatedSize is the maker order's remaining size after this fill (checked against s_orders on Day 0)
        out.push({ kind: "resize", block, id: Number(a.orderId), size: BigInt(a.updatedSize.toString()) });
        break;
      case "FlipOrderUpdated":
        out.push({ kind: "resize", block, id: Number(a.orderId), size: BigInt(a.size.toString()) });
        break;
    }
  }
  return out;
}

/**
 * Replay events in order. Returns the live book after the last event, plus a snapshot of the live
 * book at the end of each requested block (state after every event in blocks <= that block).
 * Orders created before the replay window are invisible; trades/cancels on unknown ids are ignored.
 */
export function replay(events: BookEvent[], snapshotBlocks: number[] = []) {
  const live = new Map<number, Order>();
  const snaps = new Map<number, Order[]>();
  const pending = [...snapshotBlocks].sort((a, b) => a - b);
  const takeUpTo = (block: number) => {
    while (pending.length && pending[0]! < block) snaps.set(pending.shift()!, [...live.values()].map((o) => ({ ...o })));
  };
  for (const e of events) {
    takeUpTo(e.block);
    if (e.kind === "create") live.set(e.order.id, { ...e.order });
    else if (e.kind === "cancel") e.ids.forEach((id) => live.delete(id));
    else {
      const o = live.get(e.id);
      if (!o) continue;
      if (e.size === 0n) live.delete(e.id);
      else o.size = e.size;
    }
  }
  takeUpTo(Number.MAX_SAFE_INTEGER);
  return { live, snaps };
}

/** Best bid / best ask among replayed orders (excludes Kuru's AMM vault, which emits no order logs). */
export function bestOf(orders: Order[]) {
  let bid: bigint | null = null;
  let ask: bigint | null = null;
  for (const o of orders) {
    if (o.isBuy) bid = bid === null || o.price > bid ? o.price : bid;
    else ask = ask === null || o.price < ask ? o.price : ask;
  }
  return { bid, ask };
}
