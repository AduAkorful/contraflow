// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ContraflowRegistry} from "../../src/ContraflowRegistry.sol";

/// @notice Test-only stand-in for a future upgrade. Adds nothing to storage and one pure
/// marker function, solely to prove (a) the UUPS upgrade mechanism works end-to-end and
/// (b) existing proxy storage survives an implementation swap unchanged. Never shipped.
contract ContraflowRegistryV2Mock is ContraflowRegistry {
    function version() external pure returns (uint256) {
        return 2;
    }
}
