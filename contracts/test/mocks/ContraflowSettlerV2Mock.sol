// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ContraflowSettler} from "../../src/ContraflowSettler.sol";

/// @notice Test-only stand-in for a future upgrade, mirroring ContraflowRegistryV2Mock's
/// purpose exactly: prove the UUPS upgrade mechanism and storage preservation work. Never shipped.
contract ContraflowSettlerV2Mock is ContraflowSettler {
    function version() external pure returns (uint256) {
        return 2;
    }
}
