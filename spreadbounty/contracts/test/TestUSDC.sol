// SPDX-License-Identifier: MIT
// Test-only token for local chains: 6 decimals like USDC, owner can mint. Never deployed to Monad.
pragma solidity 0.8.23;

import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";

contract TestUSDC is TokenMock {
    constructor() TokenMock("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
