/**
 * Compile the vendored, unmodified 1inch CumulativeMerkleDrop with upstream's exact settings
 * (solc 0.8.23, optimizer 1,000,000 runs, evmVersion shanghai) and write contracts/build/*.json.
 * The build is deterministic: test/drop.test.ts recompiles and compares bytecode with the committed artifact.
 *
 *   npm run drop:compile
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const VENDOR = join(ROOT, "contracts/vendor/1inch-merkle-distribution");
const require = createRequire(import.meta.url);

export const SOLC_VERSION = "0.8.23";
export const SETTINGS = { optimizer: { enabled: true, runs: 1_000_000 }, evmVersion: "shanghai" } as const;

export interface Artifact {
  contractName: string;
  abi: unknown[];
  bytecode: string;
  deployedBytecode: string;
  /** byte ranges in the runtime code that the constructor fills in (the token address); masked when comparing on-chain code */
  immutableReferences: Record<string, { start: number; length: number }[]>;
  compiler: { version: string; settings: typeof SETTINGS };
  sources: Record<string, string>; // path -> sha256 of the exact source compiled
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Resolve imports the way upstream's Hardhat build does: npm packages from node_modules, the rest from the vendored tree. */
function readImport(path: string): string {
  if (path.startsWith("@")) return readFileSync(join(ROOT, "node_modules", path), "utf8");
  if (path.startsWith("test/")) return readFileSync(join(ROOT, "contracts", path), "utf8");
  return readFileSync(join(VENDOR, path), "utf8");
}

export function compile(targets: { path: string; name: string }[] = [
  { path: "contracts/CumulativeMerkleDrop.sol", name: "CumulativeMerkleDrop" },
  { path: "@1inch/solidity-utils/contracts/mocks/TokenMock.sol", name: "TokenMock" }, // test token, never deployed to mainnet
  { path: "test/TestUSDC.sol", name: "TestUSDC" }, // 6-decimal test token for local chains
]): Artifact[] {
  const solc = require("solc");
  const version: string = solc.version();
  if (!version.startsWith(SOLC_VERSION)) throw new Error(`solc ${version} installed, need ${SOLC_VERSION} (npm i -D solc@${SOLC_VERSION})`);
  const used = new Map<string, string>();
  const input = {
    language: "Solidity",
    sources: Object.fromEntries(targets.map((t) => [t.path, { content: readImport(t.path) }])),
    settings: { ...SETTINGS, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } } },
  };
  for (const t of targets) used.set(t.path, input.sources[t.path]!.content);
  const out = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (p: string) => {
        try {
          const content = readImport(p);
          used.set(p, content);
          return { contents: content };
        } catch {
          return { error: `not found: ${p}` };
        }
      },
    }),
  );
  const errors = (out.errors ?? []).filter((e: { severity: string }) => e.severity === "error");
  if (errors.length) throw new Error(errors.map((e: { formattedMessage: string }) => e.formattedMessage).join("\n"));
  return targets.map((t) => {
    const c = out.contracts[t.path][t.name];
    return {
      contractName: t.name,
      abi: c.abi,
      bytecode: "0x" + c.evm.bytecode.object,
      deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      immutableReferences: c.evm.deployedBytecode.immutableReferences ?? {},
      compiler: { version, settings: SETTINGS },
      sources: Object.fromEntries([...used.entries()].sort().map(([p, s]) => [p, sha256(s)])),
    };
  });
}

export const BUILD = join(ROOT, "contracts/build");
export const loadArtifact = (name: string): Artifact => {
  const p = join(BUILD, `${name}.json`);
  if (!existsSync(p)) throw new Error(`${p} missing: run npm run drop:compile`);
  return JSON.parse(readFileSync(p, "utf8"));
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  mkdirSync(BUILD, { recursive: true });
  for (const a of compile()) {
    writeFileSync(join(BUILD, `${a.contractName}.json`), JSON.stringify(a, null, 2) + "\n");
    console.log(`${a.contractName}: ${(a.deployedBytecode.length - 2) / 2} bytes runtime, solc ${a.compiler.version}`);
  }
}
