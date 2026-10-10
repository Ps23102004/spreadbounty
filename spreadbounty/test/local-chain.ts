/**
 * A local EVM for trying the claim flow end to end: ganache (shanghai, chain 1337, deterministic dev accounts)
 * with a 6-decimal test token minted to dev account 0. Prints the token address; nothing here touches Monad.
 *
 *   npm run localchain
 *   RPC_URL=http://127.0.0.1:8545 SPONSOR_KEY=<ganache dev key 0> npm run drop -- deploy out/demo/campaign-ausd-usdc-demo.json --allow-chain 1337 --token <printed address> --yes
 */
import ganache from "ganache";
import { ethers } from "ethers";
import { loadArtifact } from "../src/drop/compile";

const PORT = Number(process.env.LOCALCHAIN_PORT ?? 8545);
const server = ganache.server({ logging: { quiet: true }, chain: { hardfork: "shanghai", chainId: 1337 }, wallet: { deterministic: true } });
await server.listen(PORT);
const p = new ethers.providers.JsonRpcProvider(`http://127.0.0.1:${PORT}`);
const dev = p.getSigner(0);
const a = loadArtifact("TestUSDC");
const t = await new ethers.ContractFactory(a.abi as any, a.bytecode, dev).deploy();
await t.deployed();
await (await t.mint(await dev.getAddress(), 1_000_000n * 10n ** 6n)).wait();
console.log(`local chain on http://127.0.0.1:${PORT} (id 1337). tUSDC ${t.address}: 1,000,000 minted to dev account 0 ${await dev.getAddress()}`);
