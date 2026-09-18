// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {ContraflowRegistry} from "../../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../../src/ContraflowSettler.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {Invoice, InvoiceStatus} from "../../src/interfaces/IContraflowRegistry.sol";
import {ContraflowDeployHelpers} from "../helpers/ContraflowDeployHelpers.sol";
import {ContraflowHandler} from "./handlers/ContraflowHandler.sol";

/// @notice Stateful invariant suite. Foundry drives long, random-but-handler-bounded call
/// sequences against ContraflowHandler and re-checks every `invariant_*` function after each
/// call. These are the properties that must hold no matter WHAT valid sequence of
/// register/settle calls happens — the financial guarantees the whole product depends on,
/// not any single test case.
contract ContraflowInvariantTest is Test, ContraflowDeployHelpers {
    ContraflowRegistry internal registry;
    ContraflowSettler internal settler;
    MockUSDC internal usdc;
    ContraflowHandler internal handler;

    function setUp() public {
        usdc = new MockUSDC();
        (registry, settler) = _deployContraflow(address(usdc), makeAddr("owner"));

        handler = new ContraflowHandler(registry, settler, usdc);

        // Only the handler's own bounded, always-valid actions drive the fuzzer — raw random
        // calldata against Registry/Settler directly would mostly just hit reverts from
        // malformed EIP-712 signatures, which the unit suites already cover exhaustively.
        targetContract(address(handler));
    }

    /// @notice Conservation of value: every dollar ever registered is accounted for as either
    /// still remaining on some invoice, or netted away — never both, never neither, never more
    /// or less. This is the core financial guarantee: netting only ever reciprocally cancels
    /// value that was actually registered, nothing is created or destroyed.
    function invariant_ConservationOfValue() public view {
        assertEq(
            handler.ghost_totalRegistered() - handler.ghost_totalNetted(),
            _sumAllRemaining(),
            "registered - netted must equal what's still remaining onchain"
        );
    }

    /// @notice Neither contract ever custodies the settlement asset — the entire premise of
    /// "no USDC moves except gas" depends on this holding through arbitrarily long sequences,
    /// not just a single register-then-settle happy path.
    function invariant_NeitherContractEverHoldsUsdc() public view {
        assertEq(usdc.balanceOf(address(registry)), 0, "registry must never hold USDC");
        assertEq(usdc.balanceOf(address(settler)), 0, "settler must never hold USDC");
    }

    /// @notice Status and remaining amount can never disagree: zero remaining always means
    /// ExtinguishedOnchain, and nonzero remaining always means Active. If these ever diverge,
    /// either the dashboard's "gross cancelled" tile or a future settle() attempt would be
    /// working from a wrong premise.
    function invariant_StatusAlwaysMatchesRemainingAmount() public view {
        uint256 nCycles = handler.cycleCount();
        for (uint256 c = 0; c < nCycles; ++c) {
            bytes32[] memory ids = handler.cycleIds(c);
            for (uint256 i = 0; i < ids.length; ++i) {
                Invoice memory inv = registry.getInvoice(ids[i]);
                if (inv.amountRemaining == 0) {
                    assertEq(uint8(inv.status), uint8(InvoiceStatus.ExtinguishedOnchain));
                } else {
                    assertEq(uint8(inv.status), uint8(InvoiceStatus.Active));
                }
            }
        }
    }

    /// @notice The registry/settler wiring set once at initialize() never drifts — there is no
    /// setter, but this is exactly the kind of "should be obviously true" property worth
    /// asserting explicitly rather than assuming.
    function invariant_WiringNeverChanges() public view {
        assertEq(registry.settler(), address(settler));
        assertEq(settler.registry(), address(registry));
    }

    // ==================== helpers ====================

    function _sumAllRemaining() internal view returns (uint256 sum) {
        uint256 nCycles = handler.cycleCount();
        for (uint256 c = 0; c < nCycles; ++c) {
            bytes32[] memory ids = handler.cycleIds(c);
            for (uint256 i = 0; i < ids.length; ++i) {
                sum += registry.getInvoice(ids[i]).amountRemaining;
            }
        }
    }
}
