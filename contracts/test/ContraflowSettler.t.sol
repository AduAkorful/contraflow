// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {ContraflowRegistry} from "../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../src/ContraflowSettler.sol";
import {ContraflowSettlerV2Mock} from "./mocks/ContraflowSettlerV2Mock.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {NotUUPSCompatibleMock} from "./mocks/NotUUPSCompatibleMock.sol";
import {IContraflowRegistry, InvoiceAttestation, InvoiceStatus} from "../src/interfaces/IContraflowRegistry.sol";
import {IContraflowSettler} from "../src/interfaces/IContraflowSettler.sol";

import {InvoiceSigningHelpers} from "./helpers/InvoiceSigningHelpers.sol";
import {ContraflowDeployHelpers} from "./helpers/ContraflowDeployHelpers.sol";

contract ContraflowSettlerTest is InvoiceSigningHelpers, ContraflowDeployHelpers {
    uint256 internal constant DEFAULT_AMOUNT = 1_000e6;

    ContraflowRegistry internal registry;
    ContraflowSettler internal settler;
    MockUSDC internal usdc;
    address internal owner = makeAddr("owner");

    function setUp() public {
        usdc = new MockUSDC();
        (registry, settler) = _deployContraflow(address(usdc), owner);
    }

    // ==================== helpers ====================

    struct Party {
        address addr;
        uint256 key;
    }

    /// @dev Monotonic counter folded into every generated party's label so two separate
    /// `_buildCycle`/`_party` calls within the same test never collide on the same
    /// (debtor, creditor) address pair — which would otherwise trip the registry's own
    /// nonce-replay protection between the two independent cycles, not a real bug under test.
    uint256 private _partySeq;

    function _party(string memory label) internal returns (Party memory p) {
        (p.addr, p.key) = makeAddrAndKey(string.concat(label, "#", vm.toString(_partySeq++)));
    }

    function _registerInvoice(Party memory debtorP, Party memory creditorP, uint256 nonce, uint256 amount, bool consent, uint64 maturity)
        internal
        returns (bytes32 id)
    {
        InvoiceAttestation memory inv = InvoiceAttestation({
            invoiceRef: keccak256(abi.encode(debtorP.addr, creditorP.addr, nonce)),
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

    /// @dev Builds a simple directed cycle of `n` parties P0 -> P1 -> ... -> P(n-1) -> P0,
    /// each owing `amount`, and registers all `n` invoices. Returns the ids in cycle order and
    /// the parties themselves (useful for balance / signature manipulation in specific tests).
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
            Party memory debtorP = parties[i];
            Party memory creditorP = parties[(i + 1) % n];
            ids[i] = _registerInvoice(debtorP, creditorP, 1, amount, consent, maturity);
        }
    }

    function _defaultCycle(uint256 n) internal returns (bytes32[] memory ids, Party[] memory parties) {
        return _buildCycle(n, DEFAULT_AMOUNT, true, uint64(block.timestamp + 30 days));
    }

    // ==================== initialize() ====================

    function test_Initialize_SetsRegistryAndOwner() public view {
        assertEq(settler.registry(), address(registry));
        assertEq(settler.owner(), owner);
    }

    function test_Initialize_RevertWhen_CalledTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        settler.initialize(address(registry), owner);
    }

    function test_Initialize_RevertWhen_RegistryIsZeroAddress() public {
        ContraflowSettler impl = new ContraflowSettler();
        vm.expectRevert(IContraflowSettler.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowSettler.initialize, (address(0), owner)));
    }

    function test_Initialize_RevertWhen_OwnerIsZeroAddress() public {
        ContraflowSettler impl = new ContraflowSettler();
        vm.expectRevert(IContraflowSettler.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowSettler.initialize, (address(registry), address(0))));
    }

    function test_Implementation_CannotBeInitializedDirectly() public {
        ContraflowSettler impl = new ContraflowSettler();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(address(registry), owner);
    }

    // ==================== settle() happy path ====================

    function test_Settle_WithValidCycle_SubtractsWNetFromEachInvoice() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        settler.settle(ids, 400e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(registry.getInvoice(ids[i]).amountRemaining, DEFAULT_AMOUNT - 400e6);
        }
    }

    function test_Settle_EmitsSettledEvent() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        vm.expectEmit(false, false, true, true, address(settler));
        emit IContraflowSettler.Settled(ids, 400e6, address(this));
        settler.settle(ids, 400e6);
    }

    function test_Settle_NoTokenBalanceChange() public {
        (bytes32[] memory ids, Party[] memory parties) = _defaultCycle(3);
        for (uint256 i = 0; i < parties.length; ++i) {
            usdc.mint(parties[i].addr, 5_000e6);
        }
        uint256[] memory before = new uint256[](parties.length);
        for (uint256 i = 0; i < parties.length; ++i) {
            before[i] = usdc.balanceOf(parties[i].addr);
        }

        settler.settle(ids, 400e6);

        for (uint256 i = 0; i < parties.length; ++i) {
            assertEq(usdc.balanceOf(parties[i].addr), before[i], "party USDC balance must be unchanged by settle()");
        }
        assertEq(usdc.balanceOf(address(settler)), 0, "settler must never hold USDC");
        assertEq(usdc.balanceOf(address(registry)), 0, "registry must never hold USDC");
    }

    function test_Settle_NoProtocolFee() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        uint256 totalBefore = DEFAULT_AMOUNT * 3;
        settler.settle(ids, DEFAULT_AMOUNT);
        uint256 totalAfter;
        for (uint256 i = 0; i < ids.length; ++i) {
            totalAfter += registry.getInvoice(ids[i]).amountRemaining;
        }
        assertEq(totalBefore - totalAfter, DEFAULT_AMOUNT * 3, "the full wNet must be cancelled, nothing skimmed");
    }

    function testFuzz_Settle_IsPermissionless_AnyCallerSucceeds(address caller) public {
        vm.assume(caller != address(0));
        (bytes32[] memory ids,) = _defaultCycle(3);
        vm.prank(caller);
        settler.settle(ids, 400e6);
        assertEq(registry.getInvoice(ids[0]).amountRemaining, DEFAULT_AMOUNT - 400e6);
    }

    // ==================== settle() cycle-length bounds ====================

    function test_Settle_RevertWhen_CycleLengthIsZero() public {
        bytes32[] memory ids = new bytes32[](0);
        vm.expectRevert(abi.encodeWithSelector(IContraflowSettler.CycleLengthInvalid.selector, 0));
        settler.settle(ids, 1);
    }

    function test_Settle_RevertWhen_CycleLengthBelowMin() public {
        (bytes32[] memory ids3,) = _defaultCycle(3);
        bytes32[] memory ids2 = new bytes32[](2);
        ids2[0] = ids3[0];
        ids2[1] = ids3[1];
        vm.expectRevert(abi.encodeWithSelector(IContraflowSettler.CycleLengthInvalid.selector, 2));
        settler.settle(ids2, 1);
    }

    function test_Settle_RevertWhen_CycleLengthAboveMax() public {
        (bytes32[] memory ids,) = _buildCycle(6, DEFAULT_AMOUNT, true, uint64(block.timestamp + 30 days));
        vm.expectRevert(abi.encodeWithSelector(IContraflowSettler.CycleLengthInvalid.selector, 6));
        settler.settle(ids, 1);
    }

    function testFuzz_Settle_CycleLength3to5_AllSucceed(uint256 n) public {
        n = bound(n, 3, 5);
        (bytes32[] memory ids,) = _buildCycle(n, DEFAULT_AMOUNT, true, uint64(block.timestamp + 30 days));
        settler.settle(ids, 250e6);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(registry.getInvoice(ids[i]).amountRemaining, DEFAULT_AMOUNT - 250e6);
        }
    }

    // ==================== settle() path / uniqueness ====================

    function test_Settle_RevertWhen_PathBroken() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        // Replace the middle invoice with an unrelated one so creditor[0] != debtor[1].
        Party memory outsiderDebtor = _party("outsider-debtor");
        Party memory outsiderCreditor = _party("outsider-creditor");
        bytes32 unrelated =
            _registerInvoice(outsiderDebtor, outsiderCreditor, 1, DEFAULT_AMOUNT, true, uint64(block.timestamp + 30 days));
        ids[1] = unrelated;

        vm.expectRevert(abi.encodeWithSelector(IContraflowSettler.PathBroken.selector, 0));
        settler.settle(ids, 100e6);
    }

    function test_Settle_RevertWhen_DuplicateInvoiceIdInCycle() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        ids[2] = ids[0]; // repeat the first invoice instead of a third distinct one
        vm.expectRevert(abi.encodeWithSelector(IContraflowSettler.DuplicateInvoiceId.selector, ids[0]));
        settler.settle(ids, 100e6);
    }

    function test_Settle_RevertWhen_CycleRevisitsSameParty() public {
        // A->B->A->B, 4 distinct invoice ids but only 2 distinct parties — must be rejected
        // even though PathBroken and DuplicateInvoiceId both pass.
        uint64 maturity = uint64(block.timestamp + 30 days);
        Party memory a = _party("revisit-a");
        Party memory b = _party("revisit-b");
        bytes32[] memory ids = new bytes32[](4);
        ids[0] = _registerInvoice(a, b, 1, DEFAULT_AMOUNT, true, maturity);
        ids[1] = _registerInvoice(b, a, 1, DEFAULT_AMOUNT, true, maturity);
        ids[2] = _registerInvoice(a, b, 2, DEFAULT_AMOUNT, true, maturity);
        ids[3] = _registerInvoice(b, a, 2, DEFAULT_AMOUNT, true, maturity);

        vm.expectRevert(abi.encodeWithSelector(IContraflowSettler.DuplicateParty.selector, a.addr));
        settler.settle(ids, 100e6);
    }

    function test_Settle_RevertWhen_InvoiceNotFound() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        ids[2] = bytes32(uint256(0xdead));
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotFound.selector, ids[2]));
        settler.settle(ids, 100e6);
    }

    // ==================== settle() amount / eligibility (delegated to Registry, exercised here end-to-end) ====================

    function test_Settle_RevertWhen_WNetIsZero() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        vm.expectRevert(IContraflowSettler.ZeroWNet.selector);
        settler.settle(ids, 0);
    }

    function test_Settle_RevertWhen_WNetExceedsRemaining() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowRegistry.AmountExceedsRemaining.selector, ids[0], DEFAULT_AMOUNT + 1, DEFAULT_AMOUNT)
        );
        settler.settle(ids, DEFAULT_AMOUNT + 1);
    }

    function test_Settle_RevertWhen_NotNettable_BeforeMaturityAndNoConsent() public {
        (bytes32[] memory ids,) = _buildCycle(3, DEFAULT_AMOUNT, false, uint64(block.timestamp + 30 days));
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotNettable.selector, ids[0]));
        settler.settle(ids, 100e6);
    }

    function test_Settle_SucceedsWhen_EarlyNetConsentTrue_BeforeMaturity() public {
        (bytes32[] memory ids,) = _buildCycle(3, DEFAULT_AMOUNT, true, uint64(block.timestamp + 30 days));
        settler.settle(ids, 100e6);
        assertEq(registry.getInvoice(ids[0]).amountRemaining, DEFAULT_AMOUNT - 100e6);
    }

    function test_Settle_SucceedsWhen_Matured_NoConsent() public {
        (bytes32[] memory ids,) = _buildCycle(3, DEFAULT_AMOUNT, false, uint64(block.timestamp + 1 days));
        vm.warp(block.timestamp + 2 days);
        settler.settle(ids, 100e6);
        assertEq(registry.getInvoice(ids[0]).amountRemaining, DEFAULT_AMOUNT - 100e6);
    }

    function test_Settle_SetsStatusExtinguishedOnchain_WhenRemainingHitsZero() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        settler.settle(ids, DEFAULT_AMOUNT);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(uint8(registry.getInvoice(ids[i]).status), uint8(InvoiceStatus.ExtinguishedOnchain));
        }
    }

    function test_Settle_RevertWhen_InvoiceNotActive() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        settler.settle(ids, DEFAULT_AMOUNT); // fully extinguishes all three
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotActive.selector, ids[0]));
        settler.settle(ids, 1);
    }

    function test_Settle_RevertsEntireBatch_WhenOneInvoiceFails() public {
        // A completely independent, unrelated cycle — proves the failing settle() below
        // doesn't leak any side effect into state it never touched, in addition to proving
        // it doesn't partially mutate the cycle it does touch.
        (bytes32[] memory unrelatedIds,) = _defaultCycle(3);

        // A second, independent 3-cycle with DELIBERATELY MIXED amounts: the first two
        // invoices have plenty of headroom (1_000e6) and the third has only 50e6 remaining.
        // The settler's netInvoice loop processes ids[0] and ids[1] successfully — genuinely
        // mutating their storage mid-transaction — before ids[2] fails eligibility and the
        // whole transaction reverts. This is the real atomicity proof: it's not enough that
        // an invalid settle() reverts, the point is that in-flight mutations from earlier
        // iterations of the SAME call must not survive the later revert.
        uint64 maturity = uint64(block.timestamp + 30 days);
        Party memory p0 = _party("atomic-p0");
        Party memory p1 = _party("atomic-p1");
        Party memory p2 = _party("atomic-p2");
        bytes32[] memory ids = new bytes32[](3);
        ids[0] = _registerInvoice(p0, p1, 1, 1_000e6, true, maturity);
        ids[1] = _registerInvoice(p1, p2, 1, 1_000e6, true, maturity);
        ids[2] = _registerInvoice(p2, p0, 1, 50e6, true, maturity);

        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.AmountExceedsRemaining.selector, ids[2], 400e6, 50e6));
        settler.settle(ids, 400e6);

        // the two invoices whose netInvoice call DID succeed before the revert must show no
        // trace of it afterward — proves the revert actually rolled back prior loop iterations
        assertEq(registry.getInvoice(ids[0]).amountRemaining, 1_000e6, "partial cancel occurred - atomicity violated");
        assertEq(registry.getInvoice(ids[1]).amountRemaining, 1_000e6, "partial cancel occurred - atomicity violated");
        assertEq(registry.getInvoice(ids[2]).amountRemaining, 50e6);
        // sanity: the unrelated cycle from the top of this test is untouched
        assertEq(registry.getInvoice(unrelatedIds[0]).amountRemaining, DEFAULT_AMOUNT);
    }

    function testFuzz_Settle_WNetWithinRemaining_AlwaysSucceeds(uint256 wNet) public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        wNet = bound(wNet, 1, DEFAULT_AMOUNT);
        settler.settle(ids, wNet);
        for (uint256 i = 0; i < ids.length; ++i) {
            assertEq(registry.getInvoice(ids[i]).amountRemaining, DEFAULT_AMOUNT - wNet);
        }
    }

    // ==================== UUPS upgrade mechanics ====================

    function test_AuthorizeUpgrade_RevertWhen_CallerNotOwner() public {
        ContraflowSettlerV2Mock newImpl = new ContraflowSettlerV2Mock();
        address stranger = makeAddr("stranger-upgrader");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        settler.upgradeToAndCall(address(newImpl), "");
    }

    function test_Upgrade_RevertWhen_NewImplementationNotUUPSCompatible() public {
        NotUUPSCompatibleMock badImpl = new NotUUPSCompatibleMock();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, address(badImpl)));
        settler.upgradeToAndCall(address(badImpl), "");
    }

    function test_Upgrade_SucceedsForOwnerAndPreservesStorage() public {
        (bytes32[] memory ids,) = _defaultCycle(3);
        settler.settle(ids, 100e6);

        ContraflowSettlerV2Mock newImpl = new ContraflowSettlerV2Mock();
        vm.prank(owner);
        settler.upgradeToAndCall(address(newImpl), "");

        assertEq(settler.registry(), address(registry));
        assertEq(settler.owner(), owner);
        assertEq(ContraflowSettlerV2Mock(address(settler)).version(), 2);

        // settle() still works post-upgrade against pre-upgrade invoices
        settler.settle(ids, 100e6);
        assertEq(registry.getInvoice(ids[0]).amountRemaining, DEFAULT_AMOUNT - 200e6);
    }

    // ==================== Ownable ====================

    function test_OwnershipTransfer_IsImmediateAndSingleStep() public {
        address newOwner = makeAddr("new-owner");
        vm.prank(owner);
        settler.transferOwnership(newOwner);
        assertEq(settler.owner(), newOwner);
    }

    function test_OwnershipTransfer_RevertWhen_NonOwnerInitiates() public {
        address stranger = makeAddr("stranger-owner");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        settler.transferOwnership(stranger);
    }
}
