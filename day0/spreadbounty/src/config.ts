import "dotenv/config";

// Monad mainnet addresses. Sources: monad-crypto/protocols protocols-mainnet.csv (Kuru rows) and
// kuru-sdk-py hummingbot connector constants (MON-USDC market, orderbook implementation).
export const CHAIN_ID = 143;
export const KURU_ROUTER = "0xd651346d7c789536ebf06dc72ae3c8502cd695cc";
export const KURU_MARGIN = "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5";
// Live on mainnet 2026-10-09 (EIP-1967 slot on AUSD/USDC and MON/USDC, = Router.orderBookImplementation).
// Our event decoder replayed 6,602 MON/USDC logs against it with 8/8 orders matching s_orders (reports/2026-10-11-check-MON-USDC.json).
// kuru-sdk-py constants still list the previous one, 0xea2Cc8769Fb04Ff1893Ed11cf517b7F040C823CD.
export const KNOWN_OB_IMPL = "0x5e3446c600524Be453bbCEFD46a9E4C9bE8899a0";
export const AUSD_USDC_EMPTY = "0x8cF49e35D73B19433FF4d4421637AABB680dc9Cc"; // fork study: enabled, empty
export const AUSD_USDC_CSV = "0x699abc15308156e9a3ab89ec7387e9cfe1c86a3b"; // fork study: MarketStateError
export const MON_USDC = "0x065C9d28E428A0db40191a54d33d5b7c71a9C394";
export const NATIVE = "0x0000000000000000000000000000000000000000";
// EIP-1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
export const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

const num = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);

export const cfg = {
  rpcUrl: process.env.RPC_URL ?? "https://rpc.monad.xyz",
  makerKey: process.env.MAKER_KEY,
  takerKey: process.env.TAKER_KEY,
  market: process.env.MARKET ?? AUSD_USDC_EMPTY,
  // Unset: 1.0 on the default AUSD/USDC market, live mid elsewhere. Set to "" to force the live mid.
  refPrice:
    process.env.REF_PRICE === undefined
      ? (process.env.MARKET ?? AUSD_USDC_EMPTY).toLowerCase() === AUSD_USDC_EMPTY.toLowerCase() ? 1.0 : null
      : process.env.REF_PRICE === "" ? null : Number(process.env.REF_PRICE),
  bandBps: num("BAND_BPS", 5),
  scoreBandBps: num("SCORE_BAND_BPS", 15),
  orderSize: num("ORDER_SIZE", 10),
  takerQuote: num("TAKER_QUOTE", 5),
  minReserveMon: num("MIN_MON", 11), // Monad keeps ~10 MON reserve per account; below this txs can fail
  maxTickBps: num("MAX_TICK_BPS", 5), // go rule: tick must be <= 5 bps to quote inside a stablecoin band
  lookbackBlocks: num("LOOKBACK_BLOCKS", 2000), // replay window before our first tx
  sampleEvery: num("SAMPLE_EVERY", 200), // ~1 sample/min at ~0.3 s blocks
  minRestBlocks: num("MIN_REST_BLOCKS", 20),
};
