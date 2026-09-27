// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

import {ContraflowNettingLedger} from "../src/ContraflowNettingLedger.sol";
import {
    IContraflowNettingLedger,
    CertificateEntry,
    NettingCertificate,
    NettingObligation
} from "../src/interfaces/IContraflowNettingLedger.sol";
import {NettingSigningHelpers} from "./helpers/NettingSigningHelpers.sol";
import {MockERC1271Wallet, PlainDelegate, ERC1271Delegate} from "./mocks/MockERC1271Wallet.sol";
import {ContraflowNettingLedgerV2Mock} from "./mocks/ContraflowNettingLedgerV2Mock.sol";

contract ContraflowNettingLedgerTest is NettingSigningHelpers {
    ContraflowNettingLedger internal ledger;
    address internal owner = makeAddr("owner");

    uint256[5] internal keys;
    address[5] internal parties;

    function setUp() public {
        ledger = _deployLedger(owner);
        string[5] memory names = ["alice", "bob", "carol", "dave", "erin"];
        for (uint256 i = 0; i < 5; ++i) {
            (parties[i], keys[i]) = makeAddrAndKey(names[i]);
        }
    }

    // ------------------------------------------------------------------ fixtures

    function _deployLedger(address owner_) internal returns (ContraflowNettingLedger) {
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        return ContraflowNettingLedger(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowNettingLedger.initialize, (owner_))))
        );
    }

    function _obligationIdFor(address debtor, address creditor) internal pure returns (bytes32) {
        return keccak256(abi.encode("obligation", debtor, creditor));
    }

    /// @dev A loop over the first n parties: party i owes party i+1, wrapping.
    function _loop(uint256 n, bytes32 seed) internal view returns (NettingCertificate memory cert) {
        cert.certificateId = keccak256(abi.encode("certificate", seed));
        cert.contentHash = keccak256(abi.encode("content", seed));
        cert.deadline = uint64(block.timestamp + 1 days);
        cert.entries = new CertificateEntry[](n);
        for (uint256 i = 0; i < n; ++i) {
            address debtor = parties[i];
            address creditor = parties[(i + 1) % n];
            bytes32 id = _obligationIdFor(debtor, creditor);
            cert.entries[i] = CertificateEntry({
                obligationId: id,
                debtor: debtor,
                creditor: creditor,
                priorCommitment: ledger.stateOf(_obligationKeyOf(id, debtor, creditor)),
                nextCommitment: _commitment(id, 100 * (i + 1), keccak256(abi.encode("blinding", seed, i)))
            });
        }
    }

    function _signAll(NettingCertificate memory cert) internal view returns (bytes[] memory sigs) {
        bytes32 digest = _certDigest(cert, address(ledger));
        sigs = new bytes[](cert.entries.length);
        for (uint256 i = 0; i < cert.entries.length; ++i) {
            sigs[i] = _signDigest(_keyOf(cert.entries[i].debtor), digest);
        }
    }

    function _keyOf(address party) internal view returns (uint256) {
        for (uint256 i = 0; i < 5; ++i) {
            if (parties[i] == party) return keys[i];
        }
        revert("unknown party");
    }

    function _keyFor(CertificateEntry memory e) internal pure returns (bytes32) {
        return _obligationKeyOf(e.obligationId, e.debtor, e.creditor);
    }

    // ------------------------------------------------------------------ happy paths

    function test_applyCertificate_appliesTwoPartyLoop() public {
        _assertAppliesLoop(2);
    }

    function test_applyCertificate_appliesThreePartyLoop() public {
        _assertAppliesLoop(3);
    }

    function test_applyCertificate_appliesFivePartyLoop() public {
        _assertAppliesLoop(5);
    }

    function _assertAppliesLoop(uint256 n) internal {
        NettingCertificate memory cert = _loop(n, bytes32(n));
        bytes[] memory sigs = _signAll(cert);

        for (uint256 i = 0; i < n; ++i) {
            vm.expectEmit(true, true, false, true, address(ledger));
            emit IContraflowNettingLedger.ObligationAdvanced(
                _keyFor(cert.entries[i]), cert.certificateId, bytes32(0), cert.entries[i].nextCommitment
            );
        }
        vm.expectEmit(true, true, false, true, address(ledger));
        emit IContraflowNettingLedger.CertificateApplied(cert.certificateId, cert.contentHash, address(this));

        ledger.applyCertificate(cert, sigs);

        assertTrue(ledger.isApplied(cert.certificateId));
        for (uint256 i = 0; i < n; ++i) {
            assertEq(ledger.stateOf(_keyFor(cert.entries[i])), cert.entries[i].nextCommitment);
        }
    }

    function test_applyCertificate_advancesAgainFromNonZeroPrior() public {
        NettingCertificate memory first = _loop(3, "first");
        ledger.applyCertificate(first, _signAll(first));

        NettingCertificate memory second = _loop(3, "second");
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(second.entries[i].priorCommitment, first.entries[i].nextCommitment);
        }
        ledger.applyCertificate(second, _signAll(second));

        for (uint256 i = 0; i < 3; ++i) {
            assertEq(ledger.stateOf(_keyFor(second.entries[i])), second.entries[i].nextCommitment);
        }
    }

    function test_applyCertificate_isPermissionless() public {
        NettingCertificate memory cert = _loop(3, "anyone");
        bytes[] memory sigs = _signAll(cert);
        vm.prank(makeAddr("stranger"));
        ledger.applyCertificate(cert, sigs);
        assertTrue(ledger.isApplied(cert.certificateId));
    }

    function test_applyCertificate_acceptsDeadlineEqualToNow() public {
        NettingCertificate memory cert = _loop(3, "edge");
        cert.deadline = uint64(block.timestamp);
        ledger.applyCertificate(cert, _signAll(cert));
        assertTrue(ledger.isApplied(cert.certificateId));
    }

    // ------------------------------------------------------------------ certificate-level reverts

    function test_applyCertificate_revertsOnZeroCertificateId() public {
        NettingCertificate memory cert = _loop(3, "zero-id");
        cert.certificateId = bytes32(0);
        bytes[] memory sigs = _signAll(cert);
        vm.expectRevert(IContraflowNettingLedger.ZeroCertificateId.selector);
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsWhenExpired() public {
        NettingCertificate memory cert = _loop(3, "expired");
        bytes[] memory sigs = _signAll(cert);
        vm.warp(uint256(cert.deadline) + 1);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowNettingLedger.CertificateExpired.selector, cert.deadline, block.timestamp)
        );
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnReplay() public {
        NettingCertificate memory cert = _loop(3, "replay");
        bytes[] memory sigs = _signAll(cert);
        ledger.applyCertificate(cert, sigs);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowNettingLedger.CertificateAlreadyApplied.selector, cert.certificateId)
        );
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnReusedIdWithFreshState() public {
        NettingCertificate memory first = _loop(3, "reuse");
        ledger.applyCertificate(first, _signAll(first));

        // Same id, but built on the new state — still a replay of the id.
        NettingCertificate memory second = _loop(3, "reuse-2");
        second.certificateId = first.certificateId;
        bytes[] memory sigs = _signAll(second);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowNettingLedger.CertificateAlreadyApplied.selector, first.certificateId)
        );
        ledger.applyCertificate(second, sigs);
    }

    function test_applyCertificate_revertsOnSingleEntry() public {
        NettingCertificate memory cert = _loop(2, "one");
        CertificateEntry[] memory one = new CertificateEntry[](1);
        one[0] = cert.entries[0];
        cert.entries = one;
        bytes[] memory sigs = _signAll(cert);
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.CycleLengthInvalid.selector, 1));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnEmptyEntries() public {
        NettingCertificate memory cert = _loop(2, "none");
        cert.entries = new CertificateEntry[](0);
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.CycleLengthInvalid.selector, 0));
        ledger.applyCertificate(cert, new bytes[](0));
    }

    function test_applyCertificate_revertsOnSixEntries() public {
        NettingCertificate memory cert = _loop(5, "six");
        CertificateEntry[] memory six = new CertificateEntry[](6);
        for (uint256 i = 0; i < 5; ++i) {
            six[i] = cert.entries[i];
        }
        six[5] = cert.entries[0];
        cert.entries = six;
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.CycleLengthInvalid.selector, 6));
        ledger.applyCertificate(cert, new bytes[](6));
    }

    function test_applyCertificate_revertsOnSignatureCountMismatch() public {
        NettingCertificate memory cert = _loop(3, "count");
        bytes[] memory sigs = _signAll(cert);
        bytes[] memory fewer = new bytes[](2);
        fewer[0] = sigs[0];
        fewer[1] = sigs[1];
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.SignatureCountMismatch.selector, 3, 2));
        ledger.applyCertificate(cert, fewer);
    }

    // ------------------------------------------------------------------ loop-shape reverts

    function test_applyCertificate_revertsOnBrokenPathMidLoop() public {
        NettingCertificate memory cert = _loop(3, "broken-mid");
        cert.entries[0].creditor = parties[3];
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.PathBroken.selector, 0));
        ledger.applyCertificate(cert, _signAll(cert));
    }

    function test_applyCertificate_revertsOnBrokenWraparound() public {
        NettingCertificate memory cert = _loop(3, "broken-wrap");
        cert.entries[2].creditor = parties[3];
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.PathBroken.selector, 2));
        ledger.applyCertificate(cert, _signAll(cert));
    }

    function test_applyCertificate_revertsOnDuplicateParty() public {
        // alice -> bob -> alice -> bob: a valid path, but it visits parties twice.
        NettingCertificate memory cert = _loop(2, "dup");
        CertificateEntry[] memory four = new CertificateEntry[](4);
        four[0] = cert.entries[0];
        four[1] = cert.entries[1];
        four[2] = cert.entries[0];
        four[3] = cert.entries[1];
        cert.entries = four;
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.DuplicateParty.selector, parties[0]));
        ledger.applyCertificate(cert, _signAll(cert));
    }

    function test_applyCertificate_revertsOnSelfOwedTwoPartyEntry() public {
        // Two entries both alice -> alice: the path holds but the debtor repeats.
        NettingCertificate memory cert = _loop(2, "self");
        cert.entries[0].creditor = parties[0];
        cert.entries[1].debtor = parties[0];
        cert.entries[1].creditor = parties[0];
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.DuplicateParty.selector, parties[0]));
        ledger.applyCertificate(cert, _signAll(cert));
    }

    function test_applyCertificate_revertsOnZeroDebtor() public {
        NettingCertificate memory cert = _loop(3, "zero-debtor");
        cert.entries[1].debtor = address(0);
        cert.entries[0].creditor = address(0);
        vm.expectRevert(IContraflowNettingLedger.ZeroAddress.selector);
        ledger.applyCertificate(cert, new bytes[](3));
    }

    function test_applyCertificate_revertsOnZeroCreditor() public {
        NettingCertificate memory cert = _loop(3, "zero-creditor");
        cert.entries[0].creditor = address(0);
        vm.expectRevert(IContraflowNettingLedger.ZeroAddress.selector);
        ledger.applyCertificate(cert, new bytes[](3));
    }

    // ------------------------------------------------------------------ commitment reverts

    function test_applyCertificate_revertsOnZeroNextCommitment() public {
        NettingCertificate memory cert = _loop(3, "zero-next");
        cert.entries[1].nextCommitment = bytes32(0);
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.ZeroCommitment.selector, 1));
        ledger.applyCertificate(cert, _signAll(cert));
    }

    function test_applyCertificate_revertsWhenCommitmentUnchanged() public {
        NettingCertificate memory first = _loop(3, "unchanged");
        ledger.applyCertificate(first, _signAll(first));

        NettingCertificate memory second = _loop(3, "unchanged-2");
        second.entries[2].nextCommitment = second.entries[2].priorCommitment;
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.CommitmentUnchanged.selector, 2));
        ledger.applyCertificate(second, _signAll(second));
    }

    function test_applyCertificate_revertsOnStalePriorForFreshObligation() public {
        NettingCertificate memory cert = _loop(3, "stale-fresh");
        cert.entries[1].priorCommitment = keccak256("made up");
        bytes32 key = _keyFor(cert.entries[1]);
        vm.expectRevert(
            abi.encodeWithSelector(IContraflowNettingLedger.StaleCommitment.selector, key, bytes32(0), keccak256("made up"))
        );
        ledger.applyCertificate(cert, _signAll(cert));
    }

    function test_applyCertificate_revertsWhenTwoCertificatesRaceOnSamePriorState() public {
        // Both certificates are built on the same (never-netted) state and fully signed; only the
        // first to land may apply.
        NettingCertificate memory a = _loop(3, "race-a");
        NettingCertificate memory b = _loop(3, "race-b");
        bytes[] memory sigsA = _signAll(a);
        bytes[] memory sigsB = _signAll(b);

        ledger.applyCertificate(a, sigsA);

        bytes32 key = _keyFor(b.entries[0]);
        vm.expectRevert(
            abi.encodeWithSelector(
                IContraflowNettingLedger.StaleCommitment.selector, key, a.entries[0].nextCommitment, bytes32(0)
            )
        );
        ledger.applyCertificate(b, sigsB);
    }

    function test_applyCertificate_revertsOnStaleNonZeroPrior() public {
        NettingCertificate memory first = _loop(3, "stale-1");
        ledger.applyCertificate(first, _signAll(first));
        NettingCertificate memory second = _loop(3, "stale-2");
        ledger.applyCertificate(second, _signAll(second));

        // Built on `first`'s outcome, which `second` has since replaced.
        NettingCertificate memory third = _loop(3, "stale-3");
        third.entries[0].priorCommitment = first.entries[0].nextCommitment;
        bytes32 key = _keyFor(third.entries[0]);
        vm.expectRevert(
            abi.encodeWithSelector(
                IContraflowNettingLedger.StaleCommitment.selector,
                key,
                second.entries[0].nextCommitment,
                first.entries[0].nextCommitment
            )
        );
        ledger.applyCertificate(third, _signAll(third));
    }

    function test_applyCertificate_revertsAtomicallyLeavingEarlierEntriesUntouched() public {
        NettingCertificate memory cert = _loop(3, "atomic");
        cert.entries[2].priorCommitment = keccak256("wrong");
        bytes[] memory sigs = _signAll(cert);
        vm.expectRevert();
        ledger.applyCertificate(cert, sigs);

        assertEq(ledger.stateOf(_keyFor(cert.entries[0])), bytes32(0));
        assertEq(ledger.stateOf(_keyFor(cert.entries[1])), bytes32(0));
        assertFalse(ledger.isApplied(cert.certificateId));
    }

    // ------------------------------------------------------------------ signature reverts

    function test_applyCertificate_revertsOnWrongSigner() public {
        NettingCertificate memory cert = _loop(3, "wrong-signer");
        bytes[] memory sigs = _signAll(cert);
        sigs[1] = _signDigest(keys[4], _certDigest(cert, address(ledger)));
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[1]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsWhenCreditorSignsAtDebtorIndex() public {
        NettingCertificate memory cert = _loop(3, "creditor-index");
        bytes[] memory sigs = _signAll(cert);
        // Entry 0's creditor (bob) signs in entry 0's slot — bob is a party, but not entry 0's debtor.
        sigs[0] = sigs[1];
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnMalleableSignature() public {
        NettingCertificate memory cert = _loop(3, "malleable");
        bytes[] memory sigs = _signAll(cert);
        sigs[2] = _malleable(sigs[2]);
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[2]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnGarbageSignatureBytes() public {
        NettingCertificate memory cert = _loop(3, "garbage");
        bytes[] memory sigs = _signAll(cert);
        sigs[0] = hex"deadbeef";
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnSignatureForAnotherLedger() public {
        NettingCertificate memory cert = _loop(3, "other-ledger");
        ContraflowNettingLedger other = _deployLedger(owner);
        bytes32 foreignDigest = _certDigest(cert, address(other));
        bytes[] memory sigs = new bytes[](3);
        for (uint256 i = 0; i < 3; ++i) {
            sigs[i] = _signDigest(keys[i], foreignDigest);
        }
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_revertsOnSignatureForAnotherChain() public {
        NettingCertificate memory cert = _loop(3, "other-chain");
        bytes[] memory sigs = _signAll(cert);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_signaturesCommitToContentHash() public {
        NettingCertificate memory cert = _loop(3, "content");
        bytes[] memory sigs = _signAll(cert);
        cert.contentHash = keccak256("swapped document");
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_signaturesCommitToDeadline() public {
        NettingCertificate memory cert = _loop(3, "deadline");
        bytes[] memory sigs = _signAll(cert);
        cert.deadline += 1;
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_signaturesCommitToNextCommitment() public {
        NettingCertificate memory cert = _loop(3, "next");
        bytes[] memory sigs = _signAll(cert);
        cert.entries[1].nextCommitment = keccak256("different outcome");
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, parties[0]));
        ledger.applyCertificate(cert, sigs);
    }

    // ------------------------------------------------------------------ ERC-1271 smart accounts

    /// @dev A 3-party loop where the middle party is a smart-account wallet instead of an EOA.
    function _loopWithWallet(MockERC1271Wallet wallet, bytes32 seed)
        internal
        view
        returns (NettingCertificate memory cert, bytes[] memory sigs)
    {
        cert = _loop(3, seed);
        address w = address(wallet);
        cert.entries[0].creditor = w;
        cert.entries[1].debtor = w;
        cert.entries[0].obligationId = _obligationIdFor(parties[0], w);
        cert.entries[1].obligationId = _obligationIdFor(w, parties[2]);
        bytes32 digest = _certDigest(cert, address(ledger));
        sigs = new bytes[](3);
        sigs[0] = _signDigest(keys[0], digest);
        sigs[1] = hex"01";
        sigs[2] = _signDigest(keys[2], digest);
    }

    function test_applyCertificate_acceptsApprovingSmartAccount() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet();
        (NettingCertificate memory cert, bytes[] memory sigs) = _loopWithWallet(wallet, "wallet-ok");
        wallet.approve(_certDigest(cert, address(ledger)));
        ledger.applyCertificate(cert, sigs);
        assertTrue(ledger.isApplied(cert.certificateId));
    }

    function test_applyCertificate_rejectsSmartAccountApprovingAnotherDigest() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet();
        (NettingCertificate memory cert, bytes[] memory sigs) = _loopWithWallet(wallet, "wallet-other");
        wallet.approve(keccak256("something else"));
        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, address(wallet)));
        ledger.applyCertificate(cert, sigs);
    }

    function test_applyCertificate_rejectsEveryHostileSmartAccountAnswer() public {
        MockERC1271Wallet.Mode[4] memory modes = [
            MockERC1271Wallet.Mode.AlwaysReject,
            MockERC1271Wallet.Mode.Revert,
            MockERC1271Wallet.Mode.GarbageMagic,
            MockERC1271Wallet.Mode.ShortReturn
        ];
        for (uint256 i = 0; i < modes.length; ++i) {
            MockERC1271Wallet wallet = new MockERC1271Wallet();
            (NettingCertificate memory cert, bytes[] memory sigs) = _loopWithWallet(wallet, bytes32(i));
            wallet.approve(_certDigest(cert, address(ledger)));
            wallet.setMode(modes[i]);
            vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, address(wallet)));
            ledger.applyCertificate(cert, sigs);
        }
    }

    // ------------------------------------------------------------------ EIP-7702 delegated EOAs

    function test_applyCertificate_acceptsEcdsaFromDelegatedEoaWithoutErc1271() public {
        PlainDelegate delegate = new PlainDelegate();
        vm.signAndAttachDelegation(address(delegate), keys[1]);
        PlainDelegate(parties[1]).ping(); // consumes the attached delegation; bob now has code
        assertGt(parties[1].code.length, 0, "bob should be a delegated EOA");

        NettingCertificate memory cert = _loop(3, "7702-plain");
        bytes[] memory sigs = _signAll(cert);

        // OZ's default order would reject bob's genuine signature — the reason for ECDSA-first.
        assertFalse(SignatureChecker.isValidSignatureNow(parties[1], _certDigest(cert, address(ledger)), sigs[1]));

        ledger.applyCertificate(cert, sigs);
        assertTrue(ledger.isApplied(cert.certificateId));
    }

    function test_applyCertificate_acceptsDelegatedEoaWithErc1271Delegate() public {
        ERC1271Delegate delegate = new ERC1271Delegate();
        vm.signAndAttachDelegation(address(delegate), keys[1]);
        ERC1271Delegate(parties[1]).isValidSignature(bytes32(0), new bytes(65)); // consumes the delegation
        assertGt(parties[1].code.length, 0, "bob should be a delegated EOA");

        NettingCertificate memory cert = _loop(3, "7702-1271");
        ledger.applyCertificate(cert, _signAll(cert));
        assertTrue(ledger.isApplied(cert.certificateId));
    }

    // ------------------------------------------------------------------ key binding

    function test_applyCertificate_strangersCannotTouchAnotherPairsObligation() public {
        NettingCertificate memory victim = _loop(3, "victim");
        ledger.applyCertificate(victim, _signAll(victim));
        bytes32 victimKey = _keyFor(victim.entries[0]);
        bytes32 victimState = ledger.stateOf(victimKey);

        // dave, erin and carol reuse alice->bob's obligation id in their own loop.
        NettingCertificate memory attack;
        attack.certificateId = keccak256("attack");
        attack.contentHash = keccak256("attack content");
        attack.deadline = uint64(block.timestamp + 1 days);
        attack.entries = new CertificateEntry[](3);
        address[3] memory attackers = [parties[3], parties[4], parties[2]];
        for (uint256 i = 0; i < 3; ++i) {
            attack.entries[i] = CertificateEntry({
                obligationId: victim.entries[0].obligationId,
                debtor: attackers[i],
                creditor: attackers[(i + 1) % 3],
                priorCommitment: bytes32(0),
                nextCommitment: keccak256(abi.encode("attacker state", i))
            });
        }
        ledger.applyCertificate(attack, _signAll(attack));

        assertEq(ledger.stateOf(victimKey), victimState, "victim's state must be untouched");
        assertTrue(_keyFor(attack.entries[0]) != victimKey);
    }

    // ------------------------------------------------------------------ view helpers

    function test_obligationId_matchesIndependentHashing() public view {
        NettingObligation memory o = NettingObligation({
            documentHash: keccak256("invoice 1042"),
            debtor: parties[0],
            creditor: parties[1],
            currency: "USD",
            amount: 1_250_00,
            maturity: 1_800_000_000,
            earlyNetConsent: true,
            salt: keccak256("salt")
        });
        assertEq(ledger.obligationId(o), _obligationDigest(o, address(ledger)));
    }

    function test_obligationId_dependsOnCurrency() public view {
        NettingObligation memory o = NettingObligation({
            documentHash: keccak256("invoice"),
            debtor: parties[0],
            creditor: parties[1],
            currency: "USD",
            amount: 100,
            maturity: 0,
            earlyNetConsent: false,
            salt: bytes32(0)
        });
        bytes32 usd = ledger.obligationId(o);
        o.currency = "EUR";
        assertTrue(ledger.obligationId(o) != usd);
    }

    function test_certificateDigest_matchesIndependentHashing() public view {
        for (uint256 n = 2; n <= 5; ++n) {
            NettingCertificate memory cert = _loop(n, bytes32(n));
            assertEq(ledger.certificateDigest(cert), _certDigest(cert, address(ledger)));
        }
    }

    function test_obligationKey_matchesIndependentHashing() public view {
        bytes32 id = keccak256("id");
        assertEq(ledger.obligationKey(id, parties[0], parties[1]), _obligationKeyOf(id, parties[0], parties[1]));
    }

    // ------------------------------------------------------------------ proxy and upgrades

    function test_initialize_setsOwner() public view {
        assertEq(ledger.owner(), owner);
    }

    function test_initialize_revertsOnSecondCall() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        ledger.initialize(makeAddr("usurper"));
    }

    function test_initialize_revertsOnImplementation() public {
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(owner);
    }

    function test_initialize_revertsOnZeroOwner() public {
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        vm.expectRevert(IContraflowNettingLedger.ZeroAddress.selector);
        new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowNettingLedger.initialize, (address(0))));
    }

    function test_upgradeToAndCall_revertsForNonOwner() public {
        ContraflowNettingLedgerV2Mock v2 = new ContraflowNettingLedgerV2Mock();
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(OwnableUpgradeable.OwnableUnauthorizedAccount.selector, stranger));
        ledger.upgradeToAndCall(address(v2), "");
    }

    function test_upgradeToAndCall_preservesState() public {
        NettingCertificate memory cert = _loop(3, "before-upgrade");
        ledger.applyCertificate(cert, _signAll(cert));

        ContraflowNettingLedgerV2Mock v2 = new ContraflowNettingLedgerV2Mock();
        vm.prank(owner);
        ledger.upgradeToAndCall(address(v2), "");

        assertEq(ContraflowNettingLedgerV2Mock(address(ledger)).version(), 2);
        assertTrue(ledger.isApplied(cert.certificateId));
        for (uint256 i = 0; i < 3; ++i) {
            assertEq(ledger.stateOf(_keyFor(cert.entries[i])), cert.entries[i].nextCommitment);
        }
        // Same domain after the upgrade, so the next certificate still verifies.
        NettingCertificate memory after_ = _loop(3, "after-upgrade");
        ledger.applyCertificate(after_, _signAll(after_));
    }

    // ------------------------------------------------------------------ fuzz

    function testFuzz_applyCertificate_appliesAnyValidLoop(uint8 nSeed, bytes32 seed) public {
        uint256 n = bound(nSeed, 2, 5);
        NettingCertificate memory cert = _loop(n, seed);
        ledger.applyCertificate(cert, _signAll(cert));
        for (uint256 i = 0; i < n; ++i) {
            assertEq(ledger.stateOf(_keyFor(cert.entries[i])), cert.entries[i].nextCommitment);
        }
    }

    /// @dev Any single mutation made after signing must make the certificate fail.
    function testFuzz_applyCertificate_rejectsAnyPostSigningMutation(uint8 nSeed, uint8 fieldSeed, uint8 indexSeed, bytes32 noise)
        public
    {
        vm.assume(noise != bytes32(0));
        uint256 n = bound(nSeed, 2, 5);
        uint256 idx = bound(indexSeed, 0, n - 1);
        NettingCertificate memory cert = _loop(n, noise);
        bytes[] memory sigs = _signAll(cert);

        uint256 field = bound(fieldSeed, 0, 6);
        if (field == 0) {
            cert.certificateId = cert.certificateId ^ noise;
        } else if (field == 1) {
            cert.contentHash = cert.contentHash ^ noise;
        } else if (field == 2) {
            cert.deadline = cert.deadline + 1 + uint64(uint256(noise) % 1000);
        } else if (field == 3) {
            cert.entries[idx].obligationId = cert.entries[idx].obligationId ^ noise;
        } else if (field == 4) {
            cert.entries[idx].priorCommitment = cert.entries[idx].priorCommitment ^ noise;
        } else if (field == 5) {
            bytes32 flipped = cert.entries[idx].nextCommitment ^ noise;
            vm.assume(flipped != bytes32(0));
            cert.entries[idx].nextCommitment = flipped;
        } else {
            bytes memory sig = sigs[idx];
            sig[uint256(noise) % 64] = bytes1(uint8(sig[uint256(noise) % 64]) ^ 0x01);
        }

        vm.expectRevert();
        ledger.applyCertificate(cert, sigs);
    }

    function testFuzz_applyCertificate_revertsOnAnyStalePrior(bytes32 wrongPrior, uint8 indexSeed) public {
        NettingCertificate memory first = _loop(3, "fuzz-first");
        ledger.applyCertificate(first, _signAll(first));

        uint256 idx = bound(indexSeed, 0, 2);
        vm.assume(wrongPrior != first.entries[idx].nextCommitment);
        NettingCertificate memory second = _loop(3, "fuzz-second");
        vm.assume(wrongPrior != second.entries[idx].nextCommitment);
        second.entries[idx].priorCommitment = wrongPrior;

        vm.expectRevert();
        ledger.applyCertificate(second, _signAll(second));
    }
}
