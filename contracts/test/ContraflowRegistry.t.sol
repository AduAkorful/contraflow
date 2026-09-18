// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ERC1967Utils} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Utils.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

import {ContraflowRegistry} from "../src/ContraflowRegistry.sol";
import {ContraflowRegistryV2Mock} from "./mocks/ContraflowRegistryV2Mock.sol";
import {
    IContraflowRegistry,
    InvoiceAttestation,
    Invoice,
    InvoiceStatus
} from "../src/interfaces/IContraflowRegistry.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {InvoiceSigningHelpers} from "./helpers/InvoiceSigningHelpers.sol";
import {NotUUPSCompatibleMock} from "./mocks/NotUUPSCompatibleMock.sol";

contract ContraflowRegistryTest is InvoiceSigningHelpers {
    ContraflowRegistry internal registry;
    address internal usdc = makeAddr("usdc");
    address internal settler = makeAddr("settler");
    address internal owner = makeAddr("owner");

    address internal debtor;
    uint256 internal debtorKey;
    address internal creditor;
    uint256 internal creditorKey;

    function setUp() public {
        (debtor, debtorKey) = makeAddrAndKey("debtor");
        (creditor, creditorKey) = makeAddrAndKey("creditor");

        ContraflowRegistry impl = new ContraflowRegistry();
        bytes memory initData = abi.encodeCall(ContraflowRegistry.initialize, (usdc, settler, owner));
        registry = ContraflowRegistry(address(new ERC1967Proxy(address(impl), initData)));
    }

    // ==================== helpers ====================

    function _invoice(uint256 nonce) internal view returns (InvoiceAttestation memory inv) {
        inv = InvoiceAttestation({
            invoiceRef: keccak256(abi.encode("invoice", nonce)),
            amount: 1_000e6,
            currency: usdc,
            maturity: uint64(block.timestamp + 30 days),
            earlyNetConsent: true,
            debtor: debtor,
            creditor: creditor,
            nonce: nonce,
            registry: address(registry),
            chainId: block.chainid
        });
    }

    /// @dev Thin single-arg convenience wrapper around InvoiceSigningHelpers._digest — this
    /// suite only ever signs against `registry`'s own address, so save every call site from
    /// repeating it. Overloads (not overrides) the inherited 2-arg version.
    function _digest(InvoiceAttestation memory inv) internal view returns (bytes32) {
        return _digest(inv, address(registry));
    }

    function _registerDefault() internal returns (bytes32 id, InvoiceAttestation memory inv) {
        inv = _invoice(1);
        bytes32 digest = _digest(inv);
        id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function _deployUpgradedProxy() internal view returns (ContraflowRegistryV2Mock) {
        return ContraflowRegistryV2Mock(address(registry));
    }

    // ==================== initialize() ====================

    function test_Initialize_SetsUsdcSettlerOwner() public view {
        assertEq(registry.usdc(), usdc);
        assertEq(registry.settler(), settler);
        assertEq(registry.owner(), owner);
    }

    function test_Initialize_RevertWhen_CalledTwice() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        registry.initialize(usdc, settler, owner);
    }

    function test_Initialize_RevertWhen_UsdcIsZeroAddress() public {
        ContraflowRegistry impl = new ContraflowRegistry();
        vm.expectRevert(IContraflowRegistry.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowRegistry.initialize, (address(0), settler, owner)));
    }

    function test_Initialize_RevertWhen_SettlerIsZeroAddress() public {
        ContraflowRegistry impl = new ContraflowRegistry();
        vm.expectRevert(IContraflowRegistry.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowRegistry.initialize, (usdc, address(0), owner)));
    }

    function test_Initialize_RevertWhen_OwnerIsZeroAddress() public {
        ContraflowRegistry impl = new ContraflowRegistry();
        vm.expectRevert(IContraflowRegistry.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowRegistry.initialize, (usdc, settler, address(0))));
    }

    function test_Implementation_CannotBeInitializedDirectly() public {
        ContraflowRegistry impl = new ContraflowRegistry();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(usdc, settler, owner);
    }

    // ==================== register() happy path ====================

    function test_Register_WithValidSignatures_StoresInvoice() public {
        (bytes32 id, InvoiceAttestation memory inv) = _registerDefault();

        Invoice memory stored = registry.getInvoice(id);
        assertEq(stored.debtor, debtor);
        assertEq(stored.creditor, creditor);
        assertEq(stored.amountRemaining, inv.amount);
        assertEq(stored.maturity, inv.maturity);
        assertTrue(stored.earlyNetConsent);
        assertEq(stored.nonce, inv.nonce);
        assertEq(uint8(stored.status), uint8(InvoiceStatus.Active));
    }

    function test_Register_ReturnsIdEqualToEip712Digest() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 expectedDigest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, expectedDigest), _sign(creditorKey, expectedDigest));
        assertEq(id, expectedDigest, "id must equal the EIP-712 digest that was signed (design decision #2)");
    }

    function test_Register_EmitsInvoiceRegistered() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        vm.expectEmit(true, true, true, true, address(registry));
        emit IContraflowRegistry.InvoiceRegistered(
            digest, debtor, creditor, inv.amount, inv.maturity, inv.earlyNetConsent, inv.nonce
        );
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_AllowsZeroMaturity() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.maturity = 0;
        bytes32 digest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
        assertEq(registry.getInvoice(id).maturity, 0);
    }

    function test_Register_RevertWhen_NonceSkipsAhead() public {
        InvoiceAttestation memory inv1 = _invoice(1);
        bytes32 d1 = _digest(inv1);
        registry.register(inv1, _sign(debtorKey, d1), _sign(creditorKey, d1));

        // Nonces must be registered back to back with no gaps — see NonceNotSequential's
        // NatSpec for why a merely-increasing check would be a real availability bug, not
        // just a style choice.
        InvoiceAttestation memory inv5 = _invoice(5);
        bytes32 d5 = _digest(inv5);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.NonceNotSequential.selector, 5, 2));
        registry.register(inv5, _sign(debtorKey, d5), _sign(creditorKey, d5));
    }

    function test_Register_AllowsConsecutiveNoncesInOrder() public {
        InvoiceAttestation memory inv1 = _invoice(1);
        bytes32 d1 = _digest(inv1);
        registry.register(inv1, _sign(debtorKey, d1), _sign(creditorKey, d1));

        InvoiceAttestation memory inv2 = _invoice(2);
        bytes32 d2 = _digest(inv2);
        bytes32 id2 = registry.register(inv2, _sign(debtorKey, d2), _sign(creditorKey, d2));
        assertEq(registry.getInvoice(id2).nonce, 2);
    }

    function testFuzz_Register_WithRandomAmounts(uint256 amount) public {
        amount = bound(amount, 1, type(uint256).max);
        InvoiceAttestation memory inv = _invoice(1);
        inv.amount = amount;
        bytes32 digest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
        assertEq(registry.getInvoice(id).amountRemaining, amount);
    }

    // ==================== register() nonce boundary ====================

    function test_Register_RevertWhen_FirstNonceIsZero() public {
        InvoiceAttestation memory inv = _invoice(0);
        bytes32 digest = _digest(inv);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.NonceNotSequential.selector, 0, 1));
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_SucceedsWhen_FirstNonceIsOne() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
        assertEq(registry.getInvoice(id).nonce, 1);
    }

    function test_Register_RevertWhen_NonceEqualToLastUsed() public {
        _registerDefault(); // uses nonce 1

        InvoiceAttestation memory inv = _invoice(1);
        inv.invoiceRef = keccak256("different-ref-same-nonce");
        bytes32 digest = _digest(inv);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.NonceNotSequential.selector, 1, 2));
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_NonceLowerThanLastUsed() public {
        InvoiceAttestation memory inv1 = _invoice(1);
        bytes32 d1 = _digest(inv1);
        registry.register(inv1, _sign(debtorKey, d1), _sign(creditorKey, d1));

        InvoiceAttestation memory inv2 = _invoice(2);
        bytes32 d2 = _digest(inv2);
        registry.register(inv2, _sign(debtorKey, d2), _sign(creditorKey, d2));

        InvoiceAttestation memory inv1Again = _invoice(1);
        inv1Again.invoiceRef = keccak256("different-ref-reused-nonce-1");
        bytes32 d1Again = _digest(inv1Again);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.NonceNotSequential.selector, 1, 3));
        registry.register(inv1Again, _sign(debtorKey, d1Again), _sign(creditorKey, d1Again));
    }

    // ==================== register() field validation ====================

    function test_Register_RevertWhen_ZeroAmount() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.amount = 0;
        bytes32 digest = _digest(inv);
        vm.expectRevert(IContraflowRegistry.ZeroAmount.selector);
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_DebtorIsZeroAddress() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.debtor = address(0);
        bytes32 digest = _digest(inv);
        vm.expectRevert(IContraflowRegistry.ZeroAddress.selector);
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_CreditorIsZeroAddress() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.creditor = address(0);
        bytes32 digest = _digest(inv);
        vm.expectRevert(IContraflowRegistry.ZeroAddress.selector);
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_DebtorEqualsCreditor() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.creditor = debtor;
        bytes32 digest = _digest(inv);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.SelfInvoice.selector, debtor));
        registry.register(inv, _sign(debtorKey, digest), _sign(debtorKey, digest));
    }

    function test_Register_RevertWhen_CurrencyMismatch() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.currency = makeAddr("not-usdc");
        bytes32 digest = _digest(inv);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.CurrencyMismatch.selector, inv.currency, usdc));
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_RegistryMismatch() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.registry = makeAddr("not-this-registry");
        bytes32 digest = _digest(inv);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowRegistry.RegistryMismatch.selector, inv.registry, address(registry))
        );
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_ChainIdMismatch() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.chainId = block.chainid + 1;
        bytes32 digest = _digest(inv);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowRegistry.ChainIdMismatch.selector, inv.chainId, block.chainid)
        );
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_AlreadyRegistered() public {
        (bytes32 id,) = _registerDefault();

        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceAlreadyRegistered.selector, id));
        registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));
    }

    // ==================== register() signature validation ====================

    function test_Register_RevertWhen_DebtorSignatureFromWrongSigner() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, debtor));
        registry.register(inv, _sign(strangerKey, digest), _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_CreditorSignatureFromWrongSigner() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        (, uint256 strangerKey) = makeAddrAndKey("stranger");
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, creditor));
        registry.register(inv, _sign(debtorKey, digest), _sign(strangerKey, digest));
    }

    function test_Register_RevertWhen_SignaturesSwapped() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        // creditor's valid signature passed where the debtor's is expected, and vice versa
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, debtor));
        registry.register(inv, _sign(creditorKey, digest), _sign(debtorKey, digest));
    }

    function test_Register_RevertWhen_DebtorSignatureMalformedLength() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        bytes memory tooShort = hex"1234";
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 2));
        registry.register(inv, tooShort, _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_SignatureSIsUpperHalfOrder() public {
        InvoiceAttestation memory inv = _invoice(1);
        bytes32 digest = _digest(inv);
        (,, bytes32 s) = vm.sign(debtorKey, digest);
        bytes32 sHigh = bytes32(SECP256K1N - uint256(s));
        bytes memory malleable = _makeMalleable(_sign(debtorKey, digest));

        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, sHigh));
        registry.register(inv, malleable, _sign(creditorKey, digest));
    }

    function test_Register_RevertWhen_SignatureReplayedAcrossDifferentInvoiceRef() public {
        InvoiceAttestation memory invA = _invoice(1);
        bytes32 digestA = _digest(invA);
        bytes memory debtorSigForA = _sign(debtorKey, digestA);

        InvoiceAttestation memory invB = _invoice(1);
        invB.invoiceRef = keccak256("a-different-invoice-entirely");
        bytes32 digestB = _digest(invB);

        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, debtor));
        registry.register(invB, debtorSigForA, _sign(creditorKey, digestB));
    }

    function test_Register_RevertWhen_SignatureReplayedAcrossDifferentNonce() public {
        InvoiceAttestation memory inv1 = _invoice(1);
        bytes32 digest1 = _digest(inv1);
        bytes memory debtorSigForNonce1 = _sign(debtorKey, digest1);

        InvoiceAttestation memory inv2 = _invoice(2);
        bytes32 digest2 = _digest(inv2);

        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, debtor));
        registry.register(inv2, debtorSigForNonce1, _sign(creditorKey, digest2));
    }

    // ==================== EIP-712 domain / fork safety ====================

    function test_EIP712_DomainSeparator_TracksChainIdAcrossForks() public {
        InvoiceAttestation memory invBeforeFork = _invoice(1);
        bytes32 digestBeforeFork = _digest(invBeforeFork);
        bytes memory debtorSigBeforeFork = _sign(debtorKey, digestBeforeFork);

        vm.chainId(block.chainid + 1);

        // Same struct fields, but chainId is captured as an explicit signed field too (spec
        // §13), so update it to match the new chain before recomputing what SHOULD be signed.
        InvoiceAttestation memory invAfterFork = _invoice(1);
        invAfterFork.chainId = block.chainid;
        bytes32 digestAfterFork = _digest(invAfterFork);

        // The pre-fork signature must NOT validate against the post-fork domain — proves
        // _domainSeparatorV4() actually recomputes with the live block.chainid rather than
        // serving a value cached at initialize() time.
        assertTrue(digestBeforeFork != digestAfterFork, "fork must change the digest");
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, debtor));
        registry.register(invAfterFork, debtorSigBeforeFork, _sign(creditorKey, digestAfterFork));

        // A freshly signed post-fork attestation succeeds normally.
        bytes32 id = registry.register(invAfterFork, _sign(debtorKey, digestAfterFork), _sign(creditorKey, digestAfterFork));
        assertEq(registry.getInvoice(id).debtor, debtor);
    }

    // ==================== getInvoice() ====================

    function test_GetInvoice_RevertWhen_NotFound() public {
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotFound.selector, bytes32(uint256(1))));
        registry.getInvoice(bytes32(uint256(1)));
    }

    // ==================== netInvoice() access control ====================

    function testFuzz_NetInvoice_RevertWhen_CallerNotSettler(address caller) public {
        vm.assume(caller != settler);
        (bytes32 id,) = _registerDefault();

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.NotSettler.selector, caller));
        registry.netInvoice(id, 1);
    }

    function test_NetInvoice_RevertWhen_InvoiceNotFound() public {
        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotFound.selector, bytes32(uint256(999))));
        registry.netInvoice(bytes32(uint256(999)), 1);
    }

    // ==================== netInvoice() eligibility ====================

    function test_NetInvoice_RevertWhen_NotNettable_BeforeMaturityAndNoConsent() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.earlyNetConsent = false;
        inv.maturity = uint64(block.timestamp + 30 days);
        bytes32 digest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));

        vm.prank(settler);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotNettable.selector, id));
        registry.netInvoice(id, 1);
    }

    function test_NetInvoice_SucceedsWhen_EarlyConsentTrue_BeforeMaturity() public {
        (bytes32 id,) = _registerDefault(); // earlyNetConsent = true, matures in 30 days
        vm.prank(settler);
        uint256 remaining = registry.netInvoice(id, 400e6);
        assertEq(remaining, 600e6);
    }

    function test_NetInvoice_SucceedsWhen_Matured_NoConsent() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.earlyNetConsent = false;
        inv.maturity = uint64(block.timestamp + 1 days);
        bytes32 digest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));

        vm.warp(block.timestamp + 2 days);

        vm.prank(settler);
        uint256 remaining = registry.netInvoice(id, 1_000e6);
        assertEq(remaining, 0);
    }

    function test_NetInvoice_SucceedsWhen_MaturityExactlyNow() public {
        InvoiceAttestation memory inv = _invoice(1);
        inv.earlyNetConsent = false;
        inv.maturity = uint64(block.timestamp);
        bytes32 digest = _digest(inv);
        bytes32 id = registry.register(inv, _sign(debtorKey, digest), _sign(creditorKey, digest));

        vm.prank(settler);
        uint256 remaining = registry.netInvoice(id, 1_000e6);
        assertEq(remaining, 0);
    }

    // ==================== netInvoice() amount math ====================

    function test_NetInvoice_RevertWhen_WNetExceedsRemaining() public {
        (bytes32 id,) = _registerDefault(); // amount = 1_000e6

        vm.prank(settler);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowRegistry.AmountExceedsRemaining.selector, id, 1_000e6 + 1, 1_000e6)
        );
        registry.netInvoice(id, 1_000e6 + 1);
    }

    function test_NetInvoice_PartialNet_LeavesStatusActive() public {
        (bytes32 id,) = _registerDefault();
        vm.prank(settler);
        registry.netInvoice(id, 1);
        assertEq(uint8(registry.getInvoice(id).status), uint8(InvoiceStatus.Active));
    }

    function test_NetInvoice_FullNet_SetsStatusExtinguishedOnchain() public {
        (bytes32 id,) = _registerDefault();
        vm.prank(settler);
        registry.netInvoice(id, 1_000e6);
        assertEq(uint8(registry.getInvoice(id).status), uint8(InvoiceStatus.ExtinguishedOnchain));
        assertEq(registry.getInvoice(id).amountRemaining, 0);
    }

    function test_NetInvoice_RevertWhen_CalledAgainAfterFullyExtinguished() public {
        (bytes32 id,) = _registerDefault();
        vm.startPrank(settler);
        registry.netInvoice(id, 1_000e6);
        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvoiceNotActive.selector, id));
        registry.netInvoice(id, 1);
        vm.stopPrank();
    }

    function test_NetInvoice_AllowsZeroWNet_AsHarmlessNoOp() public {
        (bytes32 id,) = _registerDefault();
        vm.prank(settler);
        uint256 remaining = registry.netInvoice(id, 0);
        assertEq(remaining, 1_000e6, "zero wNet must not change amountRemaining");
        assertEq(uint8(registry.getInvoice(id).status), uint8(InvoiceStatus.Active));
    }

    function test_NetInvoice_EmitsInvoiceNetted() public {
        (bytes32 id,) = _registerDefault();
        vm.expectEmit(true, false, false, true, address(registry));
        emit IContraflowRegistry.InvoiceNetted(id, 400e6, 600e6, InvoiceStatus.Active);
        vm.prank(settler);
        registry.netInvoice(id, 400e6);
    }

    function testFuzz_NetInvoice_WNetWithinRemaining_ReducesExactlyByWNet(uint256 wNet) public {
        (bytes32 id,) = _registerDefault(); // amount = 1_000e6
        wNet = bound(wNet, 0, 1_000e6);

        vm.prank(settler);
        uint256 remaining = registry.netInvoice(id, wNet);

        assertEq(remaining, 1_000e6 - wNet);
        InvoiceStatus expectedStatus = remaining == 0 ? InvoiceStatus.ExtinguishedOnchain : InvoiceStatus.Active;
        assertEq(uint8(registry.getInvoice(id).status), uint8(expectedStatus));
    }

    // ==================== UUPS upgrade mechanics ====================

    function test_AuthorizeUpgrade_RevertWhen_CallerNotOwner() public {
        ContraflowRegistryV2Mock newImpl = new ContraflowRegistryV2Mock();
        address stranger = makeAddr("stranger-upgrader");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        registry.upgradeToAndCall(address(newImpl), "");
    }

    function test_Upgrade_RevertWhen_NewImplementationNotUUPSCompatible() public {
        NotUUPSCompatibleMock badImpl = new NotUUPSCompatibleMock();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(ERC1967Utils.ERC1967InvalidImplementation.selector, address(badImpl))
        );
        registry.upgradeToAndCall(address(badImpl), "");
    }

    function test_Upgrade_SucceedsForOwnerAndPreservesStorage() public {
        (bytes32 id, InvoiceAttestation memory inv) = _registerDefault();

        ContraflowRegistryV2Mock newImpl = new ContraflowRegistryV2Mock();
        vm.prank(owner);
        registry.upgradeToAndCall(address(newImpl), "");

        // storage set before the upgrade must survive it untouched
        assertEq(registry.usdc(), usdc);
        assertEq(registry.settler(), settler);
        assertEq(registry.owner(), owner);
        Invoice memory stored = registry.getInvoice(id);
        assertEq(stored.debtor, debtor);
        assertEq(stored.amountRemaining, inv.amount);

        // new logic is now live
        assertEq(_deployUpgradedProxy().version(), 2);
    }

    // ==================== Ownable ====================

    function test_OwnershipTransfer_IsImmediateAndSingleStep() public {
        address newOwner = makeAddr("new-owner");

        vm.prank(owner);
        registry.transferOwnership(newOwner);

        // plain Ownable: effective immediately, no acceptance step
        assertEq(registry.owner(), newOwner);
    }

    function test_OwnershipTransfer_RevertWhen_NonOwnerInitiates() public {
        address stranger = makeAddr("stranger-owner");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        registry.transferOwnership(stranger);
    }

    function test_OwnershipTransfer_RevertWhen_NewOwnerIsZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableInvalidOwner.selector, address(0)));
        registry.transferOwnership(address(0));
    }

    /// @dev Plain Ownable's one-step transfer means a typo'd or unreachable `newOwner` argument
    /// silently locks out future upgrades — nothing reverts, there is no acceptance step to
    /// catch the mistake. Documenting this as an accepted Phase 1 risk (operator's explicit
    /// choice), not an oversight: the deployer must double-check the address before calling
    /// transferOwnership, since the contract itself provides no safety net here.
    function test_OwnershipTransfer_ToUnreachableAddress_SucceedsWithNoSafetyNet() public {
        address unreachable = address(0xdeadbeef);
        vm.prank(owner);
        registry.transferOwnership(unreachable);
        assertEq(registry.owner(), unreachable);

        // the original owner can no longer authorize an upgrade — permanently, unless
        // `unreachable` happens to be controllable. Deploy the target BEFORE arming the
        // prank: `new` inside the call's own argument list would otherwise consume the
        // single-call prank itself, making the assertion below test the wrong caller.
        ContraflowRegistryV2Mock newImpl = new ContraflowRegistryV2Mock();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, owner));
        registry.upgradeToAndCall(address(newImpl), "");
    }
}
