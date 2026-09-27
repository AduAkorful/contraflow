// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ContraflowNettingLedger} from "../../src/ContraflowNettingLedger.sol";
import {NettingLedgerHandler} from "./handlers/NettingLedgerHandler.sol";

/// @notice The ledger's guarantees under long random sequences of valid and invalid
/// certificates: no obligation is ever netted twice, valid certificates always apply, and the
/// onchain state always matches what the parties actually signed.
contract NettingLedgerInvariantTest is Test {
    ContraflowNettingLedger internal ledger;
    NettingLedgerHandler internal handler;

    function setUp() public {
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        ledger = ContraflowNettingLedger(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowNettingLedger.initialize, (makeAddr("owner")))))
        );
        handler = new NettingLedgerHandler(ledger);
        targetContract(address(handler));
    }

    /// @notice Every obligation's onchain commitment is exactly the last one its parties signed.
    function invariant_StateMatchesLastSignedCommitment() public view {
        for (uint256 i = 0; i < handler.trackedKeyCount(); ++i) {
            bytes32 key = handler.ghost_keys(i);
            assertEq(ledger.stateOf(key), handler.ghost_state(key), "commitment drifted from what was signed");
        }
    }

    /// @notice Once netted, an obligation's commitment never returns to "never netted".
    function invariant_CommitmentNeverReturnsToZero() public view {
        for (uint256 i = 0; i < handler.trackedKeyCount(); ++i) {
            assertTrue(ledger.stateOf(handler.ghost_keys(i)) != bytes32(0), "commitment reset to zero");
        }
    }

    /// @notice Stale, replayed and wrongly-signed certificates never apply.
    function invariant_InvalidCertificatesNeverApply() public view {
        assertEq(handler.ghost_unexpectedSuccess(), 0, "an invalid certificate was applied");
    }

    /// @notice A certificate built on current state and signed by every party always applies.
    function invariant_ValidCertificatesAlwaysApply() public view {
        assertEq(handler.ghost_unexpectedFailure(), 0, "a valid certificate was rejected");
    }

    /// @notice Guards against a vacuous pass: each run must actually have applied certificates
    /// and advanced real obligations, not just exercised the failure paths.
    function afterInvariant() public view {
        assertGt(handler.ghost_validApplied(), 0, "no valid certificate was applied this run");
        assertGt(handler.trackedKeyCount(), 0, "no obligation was ever advanced this run");
    }

    /// @notice Every applied certificate stays marked applied.
    function invariant_AppliedIdsStayApplied() public view {
        for (uint256 i = 0; i < handler.appliedCount(); ++i) {
            assertTrue(ledger.isApplied(handler.ghost_appliedIds(i)), "applied id forgotten");
        }
    }
}
