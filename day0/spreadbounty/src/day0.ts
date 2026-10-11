/**
 * Spreadbounty Day-0 go/no-go test on Kuru (Monad mainnet).
 *
 *   npm run check            read-only: market identity, tick, implementation, log replay vs s_orders, root determinism
 *   npm run full -- --yes    also: maker posts a two-sided quote, rests, taker fills it, attribution, scoring, cleanup
 *
 * Kill rule (from the plan): if the maker cannot rest a quote or the taker fill is not attributed to the
 * maker on both AUSD/USDC and MON/USDC, or two independent replays give different roots -> build Paylink.
 */
import { writeFileSync } from "node:fs";
import { ethers } from "ethers";
import { ERC20_ABI, MARGIN_ABI, ORDERBOOK_ABI, ROUTER_ABI } from "./abi";
import { BOOK_TOPICS, decodeBookLogs, obIface, replay } from "./book";
import { CHAIN_ID, IMPL_SLOT, KNOWN_OB_IMPL, KURU_MARGIN, KURU_ROUTER, NATIVE, cfg } from "./config";
import { getLogsChunked, withRetry } from "./rpc";
import { merkleProof, pickSampleBlocks, scoreEpoch, verifyProof, leafHash } from "./score";

type Status = "PASS" | "FAIL" | "WARN" | "SKIP" | "INFO";
const results: { step: string; status: Status; detail: string }[] = [];
const txs: Record<string, string> = {};
const report = (step: string, status: Status, detail: string) => {
  results.push({ step, status, detail });
  console.log(`[${status.padEnd(4)}] ${step}: ${detail}`);
};

const mode = process.argv[2] === "full" ? "full" : "check";
const confirmed = process.argv.includes("--yes");
const allErrors = new ethers.utils.Interface([...new Set([...ORDERBOOK_ABI, ...ROUTER_ABI, ...MARGIN_ABI].filter((f) => f.startsWith("error")))]);

/** Best-effort decode of a revert into a Kuru custom error name. */
function revertReason(e: any): string {
  const data: string | undefined = e?.error?.data?.data ?? e?.error?.data ?? e?.data ?? e?.error?.error?.data;
  if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
    try {
      return allErrors.parseError(data).name;
    } catch {
      return `unknown revert ${data.slice(0, 10)}`;
    }
  }
  return String(e?.reason ?? e?.error?.message ?? e?.message ?? e).slice(0, 200);
}

const provider = new ethers.providers.StaticJsonRpcProvider(cfg.rpcUrl, CHAIN_ID);
const market = ethers.utils.getAddress(cfg.market);
const ob = new ethers.Contract(market, ORDERBOOK_ABI, provider);
const router = new ethers.Contract(KURU_ROUTER, ROUTER_ABI, provider);
const margin = new ethers.Contract(KURU_MARGIN, MARGIN_ABI, provider);

async function send(label: string, signer: ethers.Wallet, to: string, data: string, value = ethers.constants.Zero) {
  const req = { from: signer.address, to, data, value };
  try {
    await provider.call(req); // simulate first so reverts come back decoded
  } catch (e) {
    throw new Error(`${label} would revert: ${revertReason(e)}`);
  }
  // Monad bills the declared gas limit, so keep it tight: estimate + 20%
  const gasLimit = (await provider.estimateGas(req)).mul(120).div(100);
  const tx = await signer.sendTransaction({ to, data, value, gasLimit });
  const rcpt = await tx.wait(1);
  txs[label] = tx.hash;
  if (rcpt.status !== 1) throw new Error(`${label} reverted on-chain: ${tx.hash}`);
  console.log(`       ${label}: ${tx.hash} (block ${rcpt.blockNumber}, gasUsed ${rcpt.gasUsed} / limit ${gasLimit})`);
  return rcpt;
}

async function main() {
  console.log(`Spreadbounty Day-0 (${mode}) on ${market} via ${cfg.rpcUrl}\n`);
  const net = await provider.getNetwork();
  if (net.chainId !== CHAIN_ID) throw new Error(`RPC is chain ${net.chainId}, expected ${CHAIN_ID}`);

  // ---------- 1. Market identity and params ----------
  if ((await provider.getCode(market)) === "0x") throw new Error("no contract at MARKET");
  const p = await ob.getMarketParams({ from: ethers.constants.AddressZero });
  const P = BigInt(p.pricePrecision.toString());
  const S = BigInt(p.sizePrecision.toString());
  const tick = BigInt(p.tickSize.toString());
  const minSize = BigInt(p.minSize.toString());
  const tok = (a: string) => (a === NATIVE ? null : new ethers.Contract(a, ERC20_ABI, provider));
  const base = tok(p.baseAsset), quote = tok(p.quoteAsset);
  const baseSym = base ? await base.symbol() : "MON", quoteSym = quote ? await quote.symbol() : "MON";
  const baseDec = ethers.BigNumber.from(p.baseDecimals).toNumber(), quoteDec = ethers.BigNumber.from(p.quoteDecimals).toNumber();
  report("1a market params", "INFO", `${baseSym}/${quoteSym} pricePrecision=${P} sizePrecision=${S} tick=${tick} minSize=${minSize} maxSize=${p.maxSize} fees maker/taker=${p.makerFeeBps}/${p.takerFeeBps} bps`);

  const vm = await router.verifiedMarket(market);
  const routerKnows = !ethers.BigNumber.from(vm[0]).isZero();
  const marginKnows: boolean = await margin.verifiedMarket(market);
  report("1b verified Kuru market", routerKnows && marginKnows ? "PASS" : "FAIL", `Router.verifiedMarket=${routerKnows}, MarginAccount.verifiedMarket=${marginKnows}`);

  const ref = cfg.refPrice;
  let center: number | null = ref;
  const [bb, ba] = await ob.bestBidAsk();
  const toPx = (x: ethers.BigNumber) => (x.isZero() || x.gt(ethers.constants.WeiPerEther.mul(1_000_000_000)) ? null : Number(ethers.utils.formatUnits(x, 18)));
  const liveBid = toPx(bb), liveAsk = toPx(ba);
  report("1c live top of book", "INFO", `bestBidAsk (assumed 1e18-scaled) bid=${liveBid ?? "none"} ask=${liveAsk ?? "none"}`);
  if (center === null) {
    if (liveBid === null || liveAsk === null) throw new Error("REF_PRICE empty and the book has no two-sided mid; set REF_PRICE");
    center = (liveBid + liveAsk) / 2;
  }
  const tickBps = (Number(tick) / Number(P) / center) * 1e4;
  report("1d tick size", tickBps <= cfg.maxTickBps ? "PASS" : "FAIL", `tick = ${tickBps.toFixed(3)} bps at price ${center} (go rule <= ${cfg.maxTickBps} bps)`);

  const vp = await ob.getVaultParams();
  const vaultAddr: string = vp[0];
  // getVaultParams: (vault, bestBid 1e18, bidPartiallyFilled, bestAsk 1e18, askPartiallyFilled, bidOrderSize, askOrderSize, spread)
  const vaultLive = vaultAddr !== NATIVE && !(ethers.BigNumber.from(vp[5]).isZero() && ethers.BigNumber.from(vp[6]).isZero());
  report("1e AMM vault", vaultLive ? "WARN" : "INFO", vaultAddr === NATIVE
    ? "no vault on this market"
    : `vault ${vaultAddr}: bid ${ethers.utils.formatUnits(vp[1], 18)} x ${vp[5]}, ask ${ethers.utils.formatUnits(vp[3], 18)} x ${vp[6]}, spread ${vp[7]} -> ${vaultLive ? "QUOTING: it can fill before our order" : "not quoting (zero sizes)"}`);

  // ---------- 2. Implementation pinning ----------
  const implRaw = await provider.getStorageAt(market, IMPL_SLOT);
  const impl = ethers.utils.getAddress("0x" + implRaw.slice(26));
  const routerImpl: string = await router.orderBookImplementation();
  const pinned = impl.toLowerCase() === KNOWN_OB_IMPL.toLowerCase();
  report("2 implementation", pinned ? "PASS" : "WARN", `EIP-1967 impl=${impl}, Router.orderBookImplementation=${routerImpl}, expected ${KNOWN_OB_IMPL}${pinned ? "" : " -> event decoder may not match; re-check ABI before building"}`);

  let firstBlock = await provider.getBlockNumber();
  let makerIds: number[] = [];
  let maker: ethers.Wallet | null = null;

  // ---------- 3-5. Live maker/taker test (full mode only) ----------
  if (mode === "full") {
    const isKey = (k?: string) => !!k && /^0x[0-9a-fA-F]{64}$/.test(k.trim());
    if (!isKey(cfg.makerKey) || !isKey(cfg.takerKey))
      throw new Error("MAKER_KEY / TAKER_KEY in .env are missing or still placeholders: run `npm run wallets`, fund the printed addresses, then retry");
    maker = new ethers.Wallet(cfg.makerKey!.trim(), provider);
    const taker = new ethers.Wallet(cfg.takerKey!.trim(), provider);
    if (maker.address === taker.address) throw new Error("MAKER_KEY and TAKER_KEY must be different wallets");

    const sizeRaw = (() => {
      const r = BigInt(Math.round(cfg.orderSize * Number(S)));
      return r < minSize ? minSize : r;
    })();
    const sizeHuman = Number(sizeRaw) / Number(S);
    const bidRaw = (BigInt(Math.floor(center * (1 - cfg.bandBps / 1e4) * Number(P))) / tick) * tick;
    let askRaw = ((BigInt(Math.ceil(center * (1 + cfg.bandBps / 1e4) * Number(P))) + tick - 1n) / tick) * tick;
    if (liveAsk !== null) {
      // on a live book, quote inside the best ask so the taker fill hits us, not someone else
      const liveAskRaw = BigInt(Math.round(liveAsk * Number(P)));
      if (askRaw >= liveAskRaw) askRaw = ((liveAskRaw - tick) / tick) * tick;
      if (askRaw <= bidRaw) report("3 quote placement", "WARN", "spread too tight to improve the best ask; taker may fill another maker first");
    }
    const bidPx = Number(bidRaw) / Number(P), askPx = Number(askRaw) / Number(P);
    const takerQuote = Math.min(cfg.takerQuote, sizeHuman * askPx * 0.5);

    for (const [who, w] of [["maker", maker], ["taker", taker]] as const) {
      const mon = Number(ethers.utils.formatEther(await provider.getBalance(w.address)));
      report(`3 ${who} gas`, mon >= cfg.minReserveMon ? "PASS" : "FAIL", `${w.address} holds ${mon.toFixed(3)} MON (need >= ${cfg.minReserveMon}: ~10 reserve + gas)`);
    }
    console.log(`\nPlan: maker ${maker.address} rests bid ${sizeHuman} ${baseSym} @ ${bidPx} and ask ${sizeHuman} @ ${askPx};`);
    console.log(`      taker ${taker.address} buys with ${takerQuote} ${quoteSym} through the Kuru Router.`);
    if (results.some((r) => r.status === "FAIL")) throw new Error("pre-checks failed; fix them before sending transactions");
    if (!confirmed) {
      console.log("\nDry run: re-run with `npm run full -- --yes` to send these mainnet transactions.");
      return finish();
    }

    // margin deposits for both sides
    const need: [string, ethers.Contract | null, number, ethers.BigNumber][] = [
      [p.baseAsset, base, baseDec, ethers.utils.parseUnits((sizeHuman * 1.01).toFixed(baseDec), baseDec)],
      [p.quoteAsset, quote, quoteDec, ethers.utils.parseUnits((sizeHuman * bidPx * 1.01).toFixed(quoteDec), quoteDec)],
    ];
    for (const [addr, erc, , amt] of need) {
      const have: ethers.BigNumber = await margin.getBalance(maker.address, addr);
      if (have.gte(amt)) continue;
      const top = amt.sub(have);
      if (erc) {
        if ((await erc.balanceOf(maker.address)).lt(top)) throw new Error(`maker lacks ${await erc.symbol()} to deposit ${top}`);
        if ((await erc.allowance(maker.address, KURU_MARGIN)).lt(top))
          await send(`approve ${await erc.symbol()} -> margin`, maker, addr, erc.interface.encodeFunctionData("approve", [KURU_MARGIN, top]));
      }
      await send(`deposit ${erc ? await erc.symbol() : "MON"}`, maker, KURU_MARGIN, margin.interface.encodeFunctionData("deposit", [maker.address, addr, top]), erc ? ethers.constants.Zero : top);
    }

    // post-only two-sided quote
    firstBlock = await provider.getBlockNumber();
    const placed: number[] = [];
    try {
      for (const [fn, px] of [["addBuyOrder", bidRaw], ["addSellOrder", askRaw]] as const) {
        const r = await send(fn, maker, market, obIface.encodeFunctionData(fn, [px, sizeRaw, true]));
        for (const l of r.logs) {
          if (l.address.toLowerCase() !== market.toLowerCase()) continue;
          try {
            const ev = obIface.parseLog(l);
            if (ev.name === "OrderCreated" && String(ev.args.owner).toLowerCase() === maker.address.toLowerCase()) placed.push(Number(ev.args.orderId));
          } catch {}
        }
      }
      makerIds = placed;
      report("3 maker quote rests", placed.length === 2 ? "PASS" : "FAIL", `OrderCreated owner=maker for ids [${placed.join(", ")}]`);
    } catch (e: any) {
      report("3 maker quote rests", "FAIL", e.message);
      return finish();
    }

    // read the orders back from contract state
    for (const id of placed) {
      const o = await ob.s_orders(id);
      const ok = o.ownerAddress.toLowerCase() === maker.address.toLowerCase() && BigInt(o.size.toString()) === sizeRaw;
      report(`3 s_orders(${id})`, ok ? "PASS" : "FAIL", `owner=${o.ownerAddress} size=${o.size} price=${o.price} isBuy=${o.isBuy}`);
    }

    // let the quote rest past minRest so at least one sample can score it
    const restUntil = firstBlock + cfg.minRestBlocks + cfg.sampleEvery + 5;
    console.log(`\n       resting until block ${restUntil} (~${Math.round(((restUntil - firstBlock) * 0.3))} s) so a sample can score the quote...`);
    while ((await provider.getBlockNumber()) < restUntil) await new Promise((r) => setTimeout(r, 3000));

    // ---------- 4. Taker fill attributed to maker ----------
    const amountIn = ethers.utils.parseUnits(takerQuote.toFixed(quoteDec), quoteDec);
    const minOut = ethers.utils.parseUnits(((takerQuote / askPx) * 0.995).toFixed(baseDec), baseDec);
    try {
      if (quote && (await quote.allowance(taker.address, KURU_ROUTER)).lt(amountIn))
        await send(`approve ${quoteSym} -> router`, taker, p.quoteAsset, quote.interface.encodeFunctionData("approve", [KURU_ROUTER, amountIn]));
      const r = await send(
        "taker swap",
        taker,
        KURU_ROUTER,
        router.interface.encodeFunctionData("anyToAnySwap", [[market], [true], [quote === null], p.quoteAsset, p.baseAsset, amountIn, minOut]),
        quote === null ? amountIn : ethers.constants.Zero,
      );
      const trades = r.logs
        .filter((l) => l.address.toLowerCase() === market.toLowerCase())
        .map((l) => { try { return obIface.parseLog(l); } catch { return null; } })
        .filter((ev): ev is ethers.utils.LogDescription => ev?.name === "Trade");
      const ours = trades.filter((t) => makerIds.includes(Number(t.args.orderId)));
      const attributed = ours.some((t) => String(t.args.makerAddress).toLowerCase() === maker!.address.toLowerCase());
      const origin = ours.some((t) => String(t.args.txOrigin).toLowerCase() === taker.address.toLowerCase());
      report("4 taker fill attributed", attributed && origin ? "PASS" : "FAIL",
        `${trades.length} Trade logs, ${ours.length} on maker orders; makerAddress=maker:${attributed}, txOrigin=taker:${origin}` +
        ours.map((t) => ` | order ${t.args.orderId} filled ${t.args.filledSize} remaining ${t.args.updatedSize} price(raw)=${t.args.price}`).join(""));
      // indexer view: the public RPC returns the log at the receipt block
      const seen = await provider.getLogs({ address: market, topics: [obIface.getEventTopic("Trade")], fromBlock: r.blockNumber, toBlock: r.blockNumber });
      report("4 log visible to indexer", seen.length >= ours.length && ours.length > 0 ? "PASS" : "WARN", `getLogs at block ${r.blockNumber} returned ${seen.length} Trade logs`);
    } catch (e: any) {
      report("4 taker fill attributed", "FAIL", e.message);
    }
  }

  // ---------- 5. Replay from logs vs contract state ----------
  const head = await provider.getBlockNumber();
  const from = firstBlock - cfg.lookbackBlocks;
  const filter = { address: market, topics: [BOOK_TOPICS] };
  const logsA = await getLogsChunked(provider, filter, from, head, 100, 4);
  const { live } = replay(decodeBookLogs(logsA));
  const liveOrders = [...live.values()].sort((a, b) => a.id - b.id);
  const sample = liveOrders.slice(-30);
  let match = 0;
  const mismatches: string[] = [];
  for (const o of sample) {
    const s = await withRetry<any>(() => ob.s_orders(o.id, { blockTag: head }));
    const ok = s.ownerAddress.toLowerCase() === o.owner && BigInt(s.size.toString()) === o.size && BigInt(s.price) === o.price && s.isBuy === o.isBuy;
    if (ok) match++;
    else mismatches.push(`id ${o.id}: replay owner=${o.owner} size=${o.size} price=${o.price} | chain owner=${s.ownerAddress} size=${s.size} price=${s.price}`);
  }
  const pct = sample.length ? (100 * match) / sample.length : 0;
  report("5 replay vs s_orders", sample.length === 0 ? "WARN" : pct >= 95 ? "PASS" : "FAIL",
    `${logsA.length} book logs in blocks ${from}..${head}; ${live.size} live orders replayed; ${match}/${sample.length} match s_orders at ${head} (${pct.toFixed(1)}%)` +
    (sample.length === 0 ? " -- empty book: run `npm run check` with MARKET=0x065C9d28E428A0db40191a54d33d5b7c71a9C394 (MON/USDC address) to test replay against real makers" : "") +
    (mismatches.length ? `\n         ${mismatches.slice(0, 5).join("\n         ")}` : ""));

  // ---------- 6. Deterministic scoring root from two independent fetches ----------
  const hashes = new Map<number, string>();
  const blockHash = async (n: number) => {
    if (!hashes.has(n)) hashes.set(n, (await withRetry(() => provider.getBlock(n))).hash);
    return hashes.get(n)!;
  };
  const samples = await pickSampleBlocks(from, head, cfg.sampleEvery, blockHash);
  const refRaw = cfg.refPrice !== null ? BigInt(Math.round(cfg.refPrice * Number(P))) : null;
  const run = (logs: typeof logsA) => scoreEpoch(replay(decodeBookLogs(logs), samples).snaps, refRaw, cfg.scoreBandBps, cfg.minRestBlocks);
  const logsB = await getLogsChunked(provider, filter, from, head, 50, 2);
  const a = run(logsA), b = run(logsB);
  const sameLogs = logsA.length === logsB.length && logsA.every((l, i) => l.transactionHash === logsB[i]!.transactionHash && l.logIndex === logsB[i]!.logIndex);
  report("6 root determinism", a.root === b.root && sameLogs ? "PASS" : "FAIL",
    `${samples.length} sample blocks, ${a.entries.length} scored makers; root A=${a.root} root B=${b.root}; log sets identical=${sameLogs}`);

  if (mode === "full" && maker) {
    const entry = a.entries.find(([o]) => o === maker!.address.toLowerCase());
    if (!entry) report("6 maker earned", "FAIL", "maker has no score: the quote never sat inside the band at a sample block");
    else {
      const proof = merkleProof(a.entries, maker.address, entry[1]);
      const ok = verifyProof(proof, a.root, leafHash(maker.address, entry[1]));
      report("6 maker earned", ok ? "PASS" : "FAIL", `score ${entry[1]}, 1inch-format proof (${proof.length} nodes) verifies against root: ${ok}`);
    }
    // ---------- 7. Cleanup ----------
    const stillLive: number[] = [];
    for (const id of makerIds) if (!(await ob.s_orders(id)).size.isZero()) stillLive.push(id);
    try {
      if (stillLive.length) await send("cancel maker orders", maker, market, obIface.encodeFunctionData("batchCancelOrders", [stillLive]));
      if (!process.argv.includes("--keep")) {
        for (const addr of [p.baseAsset, p.quoteAsset]) {
          const bal: ethers.BigNumber = await margin.getBalance(maker.address, addr);
          if (!bal.isZero()) await send(`withdraw ${addr === NATIVE ? "MON" : addr.slice(0, 8)}`, maker, KURU_MARGIN, margin.interface.encodeFunctionData("withdraw", [bal, addr]));
        }
      }
      report("7 cleanup", "INFO", `cancelled [${stillLive.join(", ")}]${process.argv.includes("--keep") ? ", margin kept" : ", margin withdrawn"}`);
    } catch (e: any) {
      report("7 cleanup", "WARN", `${e.message} -- cancel/withdraw manually`);
    }
  }
  return finish(a.samples);
}

function finish(samples?: unknown) {
  const fails = results.filter((r) => r.status === "FAIL");
  const verdict =
    mode === "check"
      ? fails.length ? `NO-GO on read-only checks (${fails.map((f) => f.step).join("; ")})` : "read-only checks pass -> run `npm run full -- --yes`"
      : fails.length ? `NO-GO (${fails.map((f) => f.step).join("; ")}) -> retry with MARKET=0x065C9d28E428A0db40191a54d33d5b7c71a9C394 (MON/USDC)` : "GO: build Spreadbounty";
  console.log(`\nVERDICT: ${verdict}`);
  const file = `day0-report-${mode}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify({ mode, market, config: { ...cfg, makerKey: undefined, takerKey: undefined }, results, txs, samples, verdict }, null, 2));
  console.log(`report: ${file}`);
}

main().catch((e) => {
  report("fatal", "FAIL", e?.message ?? String(e));
  finish();
  process.exitCode = 1;
});
