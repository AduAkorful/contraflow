// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ContraflowRegistry} from "../../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../../src/ContraflowSettler.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {IContraflowRegistry, InvoiceAttestation, Invoice, InvoiceStatus} from "../../src/interfaces/IContraflowRegistry.sol";

import {InvoiceSigningHelpers} from "../helpers/InvoiceSigningHelpers.sol";
import {ContraflowDeployHelpers} from "../helpers/ContraflowDeployHelpers.sol";

/// @notice End-to-end scenarios exercising the real Registry + Settler pair the way the
/// product actually gets used — full register-then-settle lifecycles, multi-cycle graphs,
/// chained partial nets, and the dashboard KPI formulas — rather than isolated single-check
/// unit assertions (those live in ContraflowRegistry.t.sol / ContraflowSettler.t.sol).
contract ContraflowIntegrationTest is InvoiceSigningHelpers, ContraflowDeployHelpers {
    ContraflowRegistry internal registry;
    ContraflowSettler internal settler;
    MockUSDC internal usdc;
    address internal owner = makeAddr("owner");
    uint256 private _partySeq;

    function setUp() public {
        usdc = new MockUSDC();
        (registry, settler) = _deployContraflow(address(usdc), owner);
    }

    // ==================== helpers ====================

    struct Party {
        address addr;
        uint256 key;
    }

    function _party(string memory label) internal returns (Party memory p) {
        (p.addr, p.key) = makeAddrAndKey(string.concat(label, "#", vm.toString(_partySeq++)));
    }

    function _registerInvoice(Party memory debtorP, Party memory creditorP, uint256 nonce, uint256 amount, bool consent, uint64 maturity)
        internal
        returns (bytes32 id)
    {
        InvoiceAttestation memory inv = InvoiceAttestation({
            invoiceRef: keccak256(abi.encode(debtorP.addr, creditorP.addr, nonce, block.timestamp)),
            amount: amount,
            currency: address(usdc),
            maturity: maturity,
            earlyNetConsent: consent,
            debtor: debtorP.addr,
            creditor: creditorP.addr,
            nonce: nonce,
            registry: address(registry),
            chainId: block.chainid
        });
        bytes32 digest = _digest(inv, address(registry));
        id = registry.register(inv, _sign(debtorP.key, digest), _sign(creditorP.key, digest));
    }

    function _buildCycle(uint256 n, uint256 amount, bool consent, uint64 maturity)
        internal
        returns (bytes32[] memory ids, Party[] memory parties)
    {
        parties = new Party[](n);
        for (uint256 i = 0; i < n; ++i) {
            parties[i] = _party(string.concat("party-", vm.toString(i)));
        }
        ids = new bytes32[](n);
        for (uint256 i = 0; i < n; ++i) {
            ids[i] = _registerInvoice(parties[i], parties[(i + 1) % n], 1, amount, consent, maturity);
        }
    }

    // ==================== scenario: the shipped demo's cycle shape ====================

    /// @dev Mirrors the demo fixture's structure (three parties, same face value on every
    /// edge, a perfect $0-cash cycle) without hardcoding the fixture's fictional names,
    /// keeping this test fixture-name-agnostic.
    function test_Integration_ThreePartyEqualCycle_FullLifecycle() public {
        uint256 faceValue = 100_000e6;
        (bytes32[] memory ids, Party[] memory parties) =
            _buildCycle(3, faceValue, true, uint64(block.timestamp + 30 days));

        for (uint256 i = 0; i < parties.length; ++i) {
            usdc.mint(parties[i].addr, faceValue);
        }

        uint256 gasBefore = gasleft();
        settler.settle(ids, faceValue);
        uint256 gasUsed = gasBefore - gasleft();

        // every invoice fully extinguished, in place, by construction
        for (uint256 i = 0; i < ids.length; ++i) {
            Invoice memory inv = registry.getInvoice(ids[i]);
            assertEq(inv.amountRemaining, 0);
            assertEq(uint8(inv.status), uint8(InvoiceStatus.ExtinguishedOnchain));
        }

        // Dashboard tiles, computed the same way the app computes them
        uint256 grossCancelled = faceValue * ids.length; // sum(wNet x cycleLength)
        assertEq(grossCancelled, 300_000e6);
        for (uint256 i = 0; i < parties.length; ++i) {
            assertEq(usdc.balanceOf(parties[i].addr), faceValue, "cash moved must be $0 - balances unchanged");
        }

        // Informational gas canary, not a hard budget: the UUPS delegatecall plus three
        // cross-contract calls into the registry cost more than a simpler, non-upgradeable
        // design would. This just catches a wild regression (e.g. an accidental unbounded
        // loop), not a precise budget.
        assertLt(gasUsed, 700_000, "settle() gas usage regressed unexpectedly for a 3-node cycle");
    }

    // ==================== scenario: sequential partial nets ====================

    function test_Integration_SequentialPartialNets_AccumulateCorrectly() public {
        (bytes32[] memory ids,) = _buildCycle(3, 1_000e6, true, uint64(block.timestamp + 30 days));

        settler.settle(ids, 300e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(registry.getInvoice(ids[i]).amountRemaining, 700e6);
        }

        settler.settle(ids, 250e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(registry.getInvoice(ids[i]).amountRemaining, 450e6);
        }

        // final settle brings it to exactly zero — status must flip on this call, not before
        settler.settle(ids, 450e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            Invoice memory inv = registry.getInvoice(ids[i]);
            assertEq(inv.amountRemaining, 0);
            assertEq(uint8(inv.status), uint8(InvoiceStatus.ExtinguishedOnchain));
        }

        // a 4th settle against the now-fully-extinguished cycle must fail cleanly
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotActive.selector, ids[0]));
        settler.settle(ids, 1);
    }

    // ==================== scenario: multiple independent cycles don't interfere ====================

    function test_Integration_TwoIndependentCycles_DoNotInterfere() public {
        (bytes32[] memory idsA,) = _buildCycle(3, 1_000e6, true, uint64(block.timestamp + 30 days));
        (bytes32[] memory idsB,) = _buildCycle(4, 500e6, true, uint64(block.timestamp + 30 days));

        settler.settle(idsA, 1_000e6);
        for (uint256 i = 0; i < idsA.length; ++i) {
            assertEq(registry.getInvoice(idsA[i]).amountRemaining, 0);
        }
        // cycle B, registered before A was settled, is completely untouched
        for (uint256 i = 0; i < idsB.length; ++i) {
            assertEq(registry.getInvoice(idsB[i]).amountRemaining, 500e6);
        }

        settler.settle(idsB, 500e6);
        for (uint256 i = 0; i < idsB.length; ++i) {
            assertEq(registry.getInvoice(idsB[i]).amountRemaining, 0);
        }
    }

    // ==================== scenario: mixed nettable eligibility blocks only the affected cycle ====================

    function test_Integration_NonNettableInvoiceBlocksOnlyItsOwnCycle() public {
        (bytes32[] memory eligibleIds,) = _buildCycle(3, 1_000e6, true, uint64(block.timestamp + 30 days));

        // A second cycle where one party never signed early-net consent and nothing has matured.
        uint64 farMaturity = uint64(block.timestamp + 30 days);
        Party memory q0 = _party("blocked-q0");
        Party memory q1 = _party("blocked-q1");
        Party memory q2 = _party("blocked-q2");
        bytes32[] memory blockedIds = new bytes32[](3);
        blockedIds[0] = _registerInvoice(q0, q1, 1, 1_000e6, true, farMaturity);
        blockedIds[1] = _registerInvoice(q1, q2, 1, 1_000e6, true, farMaturity);
        blockedIds[2] = _registerInvoice(q2, q0, 1, 1_000e6, false, farMaturity); // no consent, not matured

        settler.settle(eligibleIds, 1_000e6); // unaffected cycle succeeds

        // blockedIds[2] (q2 -> q0) is the one without consent/maturity; the settler's netting
        // loop processes ids in array order, so it's the third and last call that reverts.
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotNettable.selector, blockedIds[2]));
        settler.settle(blockedIds, 1_000e6);

        for (uint256 i = 0; i < blockedIds.length; ++i) {
            assertEq(registry.getInvoice(blockedIds[i]).amountRemaining, 1_000e6, "blocked cycle must be untouched");
        }
    }

    // ==================== scenario: a partially-netted invoice re-enters a later, different cycle ====================

    /// @dev Simulates the off-chain solver re-evaluating the graph over time: an invoice that
    /// was only partially netted in one settle() still has a live remaining balance and can be
    /// picked up in a completely different cycle later, alongside new counterparties.
    function test_Integration_PartiallyNettedInvoice_ReenteredInLaterDifferentCycle() public {
        (bytes32[] memory firstCycle, Party[] memory firstParties) =
            _buildCycle(3, 1_000e6, true, uint64(block.timestamp + 30 days));
        settler.settle(firstCycle, 300e6); // 700e6 remains on every invoice in firstCycle

        // Build a brand-new cycle that reuses firstParties[0] as one of its members, alongside
        // two new counterparties — a completely different invoice (different nonce/invoiceRef),
        // not the same invoice id.
        Party memory newParty = _party("new-party");
        Party memory anotherNewParty = _party("another-new-party");
        uint64 maturity = uint64(block.timestamp + 30 days);
        bytes32[] memory secondCycle = new bytes32[](3);
        // Nonce is keyed by (debtor, creditor) pair, not by debtor alone: firstParties[0] has
        // never invoiced newParty before, so this pair's nonce sequence starts fresh at 1 —
        // a leftover nonce of 2 here would revert NonceNotSequential post-audit-fix.
        secondCycle[0] = _registerInvoice(firstParties[0], newParty, 1, 400e6, true, maturity);
        secondCycle[1] = _registerInvoice(newParty, anotherNewParty, 1, 400e6, true, maturity);
        secondCycle[2] = _registerInvoice(anotherNewParty, firstParties[0], 1, 400e6, true, maturity);

        settler.settle(secondCycle, 400e6);
        for (uint256 i = 0; i < secondCycle.length; ++i) {
            assertEq(registry.getInvoice(secondCycle[i]).amountRemaining, 0);
        }
        // the original cycle's partial-net state from earlier is completely unaffected
        for (uint256 i = 0; i < firstCycle.length; ++i) {
            assertEq(registry.getInvoice(firstCycle[i]).amountRemaining, 700e6);
        }
    }

    // ==================== scenario: 4- and 5-party cycles end-to-end ====================

    function test_Integration_FourPartyCycle_FullLifecycle() public {
        (bytes32[] memory ids,) = _buildCycle(4, 250e6, true, uint64(block.timestamp + 30 days));
        settler.settle(ids, 250e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(uint8(registry.getInvoice(ids[i]).status), uint8(InvoiceStatus.ExtinguishedOnchain));
        }
    }

    function test_Integration_FivePartyCycle_FullLifecycle() public {
        (bytes32[] memory ids,) = _buildCycle(5, 80e6, true, uint64(block.timestamp + 30 days));
        settler.settle(ids, 80e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(uint8(registry.getInvoice(ids[i]).status), uint8(InvoiceStatus.ExtinguishedOnchain));
        }
    }

    // ==================== scenario: permissionless settle by a totally unrelated third party ====================

    function test_Integration_ThirdPartySubmitsSomeoneElsesValidCycle() public {
        (bytes32[] memory ids,) = _buildCycle(3, 1_000e6, true, uint64(block.timestamp + 30 days));
        address randomSubmitter = makeAddr("random-mempool-searcher");
        vm.prank(randomSubmitter);
        settler.settle(ids, 1_000e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(registry.getInvoice(ids[i]).amountRemaining, 0);
        }
    }
}
