// Monad mainnet constants (verified on mainnet 2026-10-09 by day0/spreadbounty `npm run check`).
export const CHAIN_ID = 143;
export const DEFAULT_RPC = "https://rpc.monad.xyz";
export const KURU_ROUTER = "0xd651346d7c789536ebf06dc72ae3c8502cd695cc";
export const KURU_MARGIN = "0x2A68ba1833cDf93fa9Da1EEbd7F46242aD8E90c5";
export const KURU_OB_IMPL = "0x5e3446c600524Be453bbCEFD46a9E4C9bE8899a0";
export const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
export const NATIVE = "0x0000000000000000000000000000000000000000";
export const USDC = "0x754704Bc059F8C67012fEd69BC8A327a5aafb603";
export const MARKETS = {
  "AUSD/USDC": "0x8cF49e35D73B19433FF4d4421637AABB680dc9Cc",
  "MON/USDC": "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
} as const;
export const BLOCK_SECONDS = 0.3; // ~300 ms blocks (laya measured ~0.33 s)
