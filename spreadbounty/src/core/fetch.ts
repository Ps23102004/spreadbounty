import { ethers } from "ethers";
import { ERC20_ABI, ORDERBOOK_ABI, ROUTER_ABI } from "./abi";
import { BOOK_TOPICS } from "./book";
import { CHAIN_ID, DEFAULT_RPC, IMPL_SLOT, KURU_ROUTER, MARKETS, NATIVE } from "./chain";
import { getLogsChunked, withRetry, type RawLog } from "./rpc";

export const provider = (url = process.env.RPC_URL ?? DEFAULT_RPC) => new ethers.providers.StaticJsonRpcProvider(url, CHAIN_ID);

/** Accepts "AUSD/USDC", "MON/USDC" or a market address. */
export function resolveMarket(m: string): string {
  const named = (MARKETS as Record<string, string>)[m.toUpperCase()];
  return ethers.utils.getAddress(named ?? m);
}

export async function fetchBookLogs(p: ethers.providers.JsonRpcProvider, market: string, from: number, to: number): Promise<RawLog[]> {
  return getLogsChunked(p, { address: market, topics: [BOOK_TOPICS] }, from, to);
}

export function blockHashes(p: ethers.providers.JsonRpcProvider) {
  const cache = new Map<number, string>();
  return async (n: number) => {
    if (!cache.has(n)) cache.set(n, (await withRetry(() => p.getBlock(n))).hash);
    return cache.get(n)!;
  };
}

export async function readMarket(p: ethers.providers.JsonRpcProvider, marketIn: string) {
  const market = resolveMarket(marketIn);
  const ob = new ethers.Contract(market, ORDERBOOK_ABI, p);
  const router = new ethers.Contract(KURU_ROUTER, ROUTER_ABI, p);
  const mp = await ob.getMarketParams({ from: NATIVE });
  const sym = async (a: string) => (a === NATIVE ? "MON" : await new ethers.Contract(a, ERC20_ABI, p).symbol());
  const [base, quote] = await Promise.all([sym(mp.baseAsset), sym(mp.quoteAsset)]);
  const [bb, ba] = await ob.bestBidAsk();
  const px = (x: ethers.BigNumber) => (x.isZero() || x.gt(ethers.constants.WeiPerEther.mul(1_000_000_000)) ? null : Number(ethers.utils.formatUnits(x, 18)));
  const vp = await ob.getVaultParams();
  const implRaw = await p.getStorageAt(market, IMPL_SLOT);
  const verified = !ethers.BigNumber.from((await router.verifiedMarket(market))[0]).isZero();
  const P = Number(mp.pricePrecision), tick = Number(mp.tickSize);
  const bid = px(bb), ask = px(ba);
  const mid = bid !== null && ask !== null ? (bid + ask) / 2 : null;
  return {
    market,
    pair: `${base}/${quote}`,
    verifiedKuruMarket: verified,
    implementation: ethers.utils.getAddress("0x" + implRaw.slice(26)),
    pricePrecision: mp.pricePrecision.toString(),
    sizePrecision: mp.sizePrecision.toString(),
    tickSize: tick,
    tickBpsAtMid: mid ? (tick / P / mid) * 1e4 : null,
    minSize: Number(mp.minSize) / Number(mp.sizePrecision),
    feesBps: { maker: Number(mp.makerFeeBps), taker: Number(mp.takerFeeBps) },
    bestBid: bid,
    bestAsk: ask,
    spreadBps: bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 1e4 : null,
    vault: {
      address: vp[0] as string,
      quoting: vp[0] !== NATIVE && !(ethers.BigNumber.from(vp[5]).isZero() && ethers.BigNumber.from(vp[6]).isZero()),
    },
    head: await p.getBlockNumber(),
  };
}
