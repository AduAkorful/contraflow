// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ContraflowNettingLedger} from "../../../src/ContraflowNettingLedger.sol";
import {CertificateEntry, NettingCertificate} from "../../../src/interfaces/IContraflowNettingLedger.sol";
import {NettingSigningHelpers} from "../../helpers/NettingSigningHelpers.sol";

/// @notice Drives the ledger with a mix of valid certificates and ones that must fail (stale
/// priors, replays, a signature from someone outside the loop), mirroring every successful
/// application in ghost state. Never reverts itself: each outcome is recorded instead, so the
/// invariants can assert that valid certificates always apply and invalid ones never do.
contract NettingLedgerHandler is NettingSigningHelpers {
    uint256 internal constant PARTY_COUNT = 5;

    ContraflowNettingLedger public immutable ledger;

    uint256[PARTY_COUNT] internal partyKeys;
    address[PARTY_COUNT] internal partyAddrs;
    uint256 internal outsiderKey;

    mapping(bytes32 key => bytes32 commitment) public ghost_state;
    bytes32[] public ghost_keys;
    mapping(bytes32 key => bool tracked) internal _tracked;
    bytes32[] public ghost_appliedIds;
    bytes[] internal _appliedCalldata;

    uint256 public ghost_nonce;
    uint256 public ghost_unexpectedSuccess;
    uint256 public ghost_unexpectedFailure;
    uint256 public ghost_validApplied;

    constructor(ContraflowNettingLedger ledger_) {
        ledger = ledger_;
        for (uint256 i = 0; i < PARTY_COUNT; ++i) {
            (partyAddrs[i], partyKeys[i]) = makeAddrAndKey(string(abi.encodePacked("party", vm.toString(i))));
        }
        (, outsiderKey) = makeAddrAndKey("outsider");
    }

    // ------------------------------------------------------------------ building blocks

    /// @dev Picks n distinct parties from the pool in a seed-dependent order.
    function _pickParties(uint256 seed, uint256 n) internal pure returns (uint256[] memory idx) {
        uint256[PARTY_COUNT] memory pool = [uint256(0), 1, 2, 3, 4];
        for (uint256 i = PARTY_COUNT - 1; i > 0; --i) {
            uint256 j = uint256(keccak256(abi.encode(seed, i))) % (i + 1);
            (pool[i], pool[j]) = (pool[j], pool[i]);
        }
        idx = new uint256[](n);
        for (uint256 i = 0; i < n; ++i) {
            idx[i] = pool[i];
        }
    }

    function _build(uint256 seed, uint256 n) internal returns (NettingCertificate memory cert, uint256[] memory idx) {
        idx = _pickParties(seed, n);
        uint256 nonce = ++ghost_nonce;
        cert.certificateId = keccak256(abi.encode("cert", nonce));
        cert.contentHash = keccak256(abi.encode("content", nonce));
        cert.deadline = uint64(block.timestamp + 1 days);
        cert.entries = new CertificateEntry[](n);
        for (uint256 i = 0; i < n; ++i) {
            address d = partyAddrs[idx[i]];
            address c = partyAddrs[idx[(i + 1) % n]];
            bytes32 id = keccak256(abi.encode("obligation", d, c));
            bytes32 prior = ghost_state[_obligationKeyOf(id, d, c)];
            cert.entries[i] = CertificateEntry({
                obligationId: id,
                debtor: d,
                creditor: c,
                priorCommitment: prior,
                nextCommitment: keccak256(abi.encode("state", nonce, i))
            });
        }
    }

    function _sign(NettingCertificate memory cert, uint256[] memory idx) internal view returns (bytes[] memory sigs) {
        bytes32 digest = _certDigest(cert, address(ledger));
        sigs = new bytes[](idx.length);
        for (uint256 i = 0; i < idx.length; ++i) {
            sigs[i] = _signDigest(partyKeys[idx[i]], digest);
        }
    }

    function _try(NettingCertificate memory cert, bytes[] memory sigs) internal returns (bool ok) {
        try ledger.applyCertificate(cert, sigs) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    // ------------------------------------------------------------------ actions

    function applyValid(uint256 seed, uint8 nSeed) external {
        uint256 n = bound(nSeed, 2, PARTY_COUNT);
        (NettingCertificate memory cert, uint256[] memory idx) = _build(seed, n);
        bytes[] memory sigs = _sign(cert, idx);

        if (!_try(cert, sigs)) {
            ++ghost_unexpectedFailure;
            return;
        }
        ++ghost_validApplied;
        ghost_appliedIds.push(cert.certificateId);
        _appliedCalldata.push(abi.encode(cert, sigs));
        for (uint256 i = 0; i < n; ++i) {
            CertificateEntry memory e = cert.entries[i];
            bytes32 key = _obligationKeyOf(e.obligationId, e.debtor, e.creditor);
            ghost_state[key] = e.nextCommitment;
            if (!_tracked[key]) {
                _tracked[key] = true;
                ghost_keys.push(key);
            }
        }
    }

    function applyStale(uint256 seed, uint8 nSeed, uint8 entrySeed) external {
        uint256 n = bound(nSeed, 2, PARTY_COUNT);
        (NettingCertificate memory cert, uint256[] memory idx) = _build(seed, n);
        uint256 e = bound(entrySeed, 0, n - 1);
        cert.entries[e].priorCommitment = keccak256(abi.encode("stale", cert.entries[e].priorCommitment));
        if (_try(cert, _sign(cert, idx))) ++ghost_unexpectedSuccess;
    }

    function replay(uint256 which) external {
        if (_appliedCalldata.length == 0) return;
        (NettingCertificate memory cert, bytes[] memory sigs) =
            abi.decode(_appliedCalldata[which % _appliedCalldata.length], (NettingCertificate, bytes[]));
        if (_try(cert, sigs)) ++ghost_unexpectedSuccess;
    }

    function applyWithOutsiderSignature(uint256 seed, uint8 nSeed, uint8 entrySeed) external {
        uint256 n = bound(nSeed, 2, PARTY_COUNT);
        (NettingCertificate memory cert, uint256[] memory idx) = _build(seed, n);
        bytes[] memory sigs = _sign(cert, idx);
        sigs[bound(entrySeed, 0, n - 1)] = _signDigest(outsiderKey, _certDigest(cert, address(ledger)));
        if (_try(cert, sigs)) ++ghost_unexpectedSuccess;
    }

    function passTime(uint32 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1, 2 days));
    }

    // ------------------------------------------------------------------ views for invariants

    function trackedKeyCount() external view returns (uint256) {
        return ghost_keys.length;
    }

    function appliedCount() external view returns (uint256) {
        return ghost_appliedIds.length;
    }
}
