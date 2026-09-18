// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Minimal 6-decimal ERC-20 standing in for Arc's canonical USDC in tests. Only used
/// to give test wallets a real, checkable token balance so "no USDC moves except gas" (spec
/// §11.2) can be asserted against actual balanceOf() calls, not merely inferred from the
/// absence of transfer calls in ContraflowSettler/ContraflowRegistry's source.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
