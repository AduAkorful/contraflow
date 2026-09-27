// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ContraflowNettingLedger} from "../../src/ContraflowNettingLedger.sol";

/// @notice Test-only upgrade target: proves UUPS upgrades work and leave `_state`/`_applied`
/// intact. Never shipped.
contract ContraflowNettingLedgerV2Mock is ContraflowNettingLedger {
    function version() external pure returns (uint256) {
        return 2;
    }
}
