# Vendored: 1inch merkle-distribution (unmodified)

Fetched 2026-10-10 from the `master` branch of https://github.com/1inch/merkle-distribution (MIT, see LICENSE.md):

| File | Upstream URL | sha256 |
|---|---|---|
| `contracts/CumulativeMerkleDrop.sol` | https://raw.githubusercontent.com/1inch/merkle-distribution/master/contracts/CumulativeMerkleDrop.sol | `212cda8f0c66bee840c616cb95ffebb60935fbbe78f9176e344bde8609db2117` |
| `contracts/interfaces/ICumulativeMerkleDrop.sol` | https://raw.githubusercontent.com/1inch/merkle-distribution/master/contracts/interfaces/ICumulativeMerkleDrop.sol | `6bf0d43c48d1ee52baf9f93c6ae34fcdbe22d1be51640eace7062485e45ef9f8` |

Upstream's dependency pins and compiler settings (`package.json`, `hardhat.config.ts`), reproduced in `src/drop/compile.ts`:
`@openzeppelin/contracts` 5.4.0, `@1inch/solidity-utils` 6.9.16, solc 0.8.23, optimizer on with 1,000,000 runs, evmVersion shanghai.

The commit hash could not be recorded (the GitHub API was not reachable from the build environment). `npm run test:drop` re-checks both sha256 values, so any edit to these files fails the tests.
