/**
 * A fake Monad JSON-RPC that serves the demo dataset (out/demo/chain.json): getLogs, the Kuru views the bot reads,
 * and a block number that advances on every call, so the live bot's code path runs end to end with no network.
 * Read-only: it refuses eth_sendRawTransaction.
 *
 *   npm run fakechain        then   RPC_URL=http://localhost:8546 npm run bot -- plan out/demo/campaign-ausd-usdc-demo.json
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ethers } from "ethers";
import { MARGIN_ABI, ORDERBOOK_ABI, ROUTER_ABI, ERC20_ABI } from "../src/core/abi";
import { bestOf, decodeBookLogs, replay } from "../src/core/book";
import { KURU_MARGIN, KURU_ROUTER, NATIVE, USDC } from "../src/core/chain";
import type { RawLog } from "../src/core/rpc";

const ob = new ethers.utils.Interface(ORDERBOOK_ABI), router = new ethers.utils.Interface(ROUTER_ABI), margin = new ethers.utils.Interface(MARGIN_ABI), erc = new ethers.utils.Interface(ERC20_ABI);
const AUSD = "0x00000000000000000000000000000000000a05d0"; // placeholder token address for the demo
const hex = (n: number | bigint) => "0x" + n.toString(16);

export async function startFakeChain(opts: { startBlock?: number; step?: number; port?: number; dir?: string } = {}) {
  const chain = JSON.parse(readFileSync(`${opts.dir ?? "out/demo"}/chain.json`, "utf8")) as { head: number; markets: Record<string, any>; logs: Record<string, RawLog[]> };
  const markets = new Map(Object.values(chain.markets).map((m: any) => [m.market.toLowerCase(), m]));
  let head = opts.startBlock ?? chain.head - 6000;
  const step = opts.step ?? 7;
  const logsOf = (addr: string) => chain.logs[addr.toLowerCase()] ?? [];

  const call = (to: string, data: string): string => {
    const t = to.toLowerCase();
    const m = markets.get(t);
    if (m) {
      const f = ob.getFunction(data.slice(0, 10));
      const base = m.pair.startsWith("MON") ? NATIVE : AUSD;
      if (f.name === "getMarketParams")
        return ob.encodeFunctionResult(f, [m.pricePrecision, m.sizePrecision, base, 18, USDC, 6, m.tickSize, BigInt(Math.round(m.minSize * Number(m.sizePrecision))), 10n ** 27n, 0, 0]);
      if (f.name === "bestBidAsk") {
        const { live } = replay(decodeBookLogs(logsOf(t).filter((l) => l.blockNumber <= head)));
        const { bid, ask } = bestOf([...live.values()]);
        const P = BigInt(m.pricePrecision);
        return ob.encodeFunctionResult(f, [bid === null ? 0 : (bid * 10n ** 18n) / P, ask === null ? (1n << 255n) : (ask * 10n ** 18n) / P]);
      }
      if (f.name === "getVaultParams") return ob.encodeFunctionResult(f, [m.vault.address, 0, 0, 0, 0, 0, 0, 0]);
    }
    if (t === KURU_ROUTER.toLowerCase()) {
      const args = router.decodeFunctionData("verifiedMarket", data);
      const known = markets.has(String(args[0]).toLowerCase());
      return router.encodeFunctionResult("verifiedMarket", [known ? 1 : 0, 0, NATIVE, 0, NATIVE, 0, 0, 0, 0, 0, 0]);
    }
    if (t === KURU_MARGIN.toLowerCase()) return margin.encodeFunctionResult("getBalance", [0]);
    if (t === AUSD) return erc.encodeFunctionResult("symbol", ["AUSD"]);
    if (t === USDC.toLowerCase()) return erc.encodeFunctionResult("symbol", ["USDC"]);
    throw new Error(`fake chain: no contract at ${to}`);
  };

  const handle = (method: string, params: any[]): unknown => {
    switch (method) {
      case "eth_chainId": return hex(143);
      case "net_version": return "143";
      case "eth_blockNumber": {
        const max = Math.max(...Object.values(chain.logs).flat().map((l) => l.blockNumber));
        head = Math.min(head + step, Math.max(max, chain.head));
        return hex(head);
      }
      case "eth_getBalance": return hex(10n ** 18n);
      case "eth_getStorageAt": {
        const m = markets.get(String(params[0]).toLowerCase());
        return ethers.utils.hexZeroPad(m?.implementation ?? NATIVE, 32);
      }
      case "eth_call": return call(params[0].to, params[0].data);
      case "eth_getLogs": {
        const f = params[0];
        const from = parseInt(f.fromBlock, 16), to = Math.min(parseInt(f.toBlock, 16), head);
        return logsOf(f.address)
          .filter((l) => l.blockNumber >= from && l.blockNumber <= to)
          .map((l) => ({ ...l, blockNumber: hex(l.blockNumber), logIndex: hex(l.logIndex), transactionIndex: hex(l.transactionIndex ?? 0) }));
      }
      case "eth_sendRawTransaction": throw new Error("fake chain is read-only");
      default: throw new Error(`fake chain: ${method} not supported`);
    }
  };

  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const one = (r: { id: unknown; method: string; params?: any[] }) => {
      try {
        return { jsonrpc: "2.0", id: r.id, result: handle(r.method, r.params ?? []) };
      } catch (e: any) {
        return { jsonrpc: "2.0", id: r.id, error: { code: -32000, message: String(e?.message ?? e) } };
      }
    };
    const body = JSON.parse(raw);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)));
  });
  await new Promise<void>((r) => server.listen(opts.port ?? 0, r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, close: () => server.close(), head: () => head };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = await startFakeChain({ port: Number(process.env.FAKECHAIN_PORT ?? 8546) });
  console.log(`fake Monad RPC (demo data, read-only) on ${c.url}`);
}
