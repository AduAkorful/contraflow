// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";
import {
    CertificateEntry,
    NettingCertificate,
    NettingObligation
} from "../../src/interfaces/IContraflowNettingLedger.sol";

/// @notice EIP-712 hashing and signing for ContraflowNettingLedger tests, written independently of
/// the contract's own hashing — the type strings are spelled out here from the spec, not copied
/// from the contract, so a typo in either shows up as a digest mismatch instead of being masked.
abstract contract NettingSigningHelpers is Test {
    bytes32 internal constant NETTING_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    string internal constant ENTRY_TYPE =
        "CertificateEntry(bytes32 obligationId,address debtor,address creditor,bytes32 priorCommitment,bytes32 nextCommitment)";

    // secp256k1 curve order n, sourced from OpenZeppelin's ECDSA.sol doc comment.
    uint256 internal constant CURVE_ORDER = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _ledgerDomainSeparator(address ledger) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                NETTING_DOMAIN_TYPEHASH,
                keccak256(bytes("ContraflowNettingLedger")),
                keccak256(bytes("1")),
                block.chainid,
                ledger
            )
        );
    }

    function _obligationDigest(NettingObligation memory o, address ledger) internal view returns (bytes32) {
        bytes32 typeHash = keccak256(
            "NettingObligation(bytes32 documentHash,address debtor,address creditor,string currency,uint256 amount,uint64 maturity,bool earlyNetConsent,bytes32 salt)"
        );
        bytes32 structHash = keccak256(
            abi.encode(
                typeHash,
                o.documentHash,
                o.debtor,
                o.creditor,
                keccak256(bytes(o.currency)),
                o.amount,
                o.maturity,
                o.earlyNetConsent,
                o.salt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _ledgerDomainSeparator(ledger), structHash));
    }

    function _entryHash(CertificateEntry memory e) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(keccak256(bytes(ENTRY_TYPE)), e.obligationId, e.debtor, e.creditor, e.priorCommitment, e.nextCommitment)
        );
    }

    function _certDigest(NettingCertificate memory c, address ledger) internal view returns (bytes32) {
        bytes memory packed;
        for (uint256 i = 0; i < c.entries.length; ++i) {
            packed = bytes.concat(packed, _entryHash(c.entries[i]));
        }
        bytes32 typeHash = keccak256(
            bytes.concat(
                "NettingCertificate(bytes32 certificateId,bytes32 contentHash,uint64 deadline,CertificateEntry[] entries)",
                bytes(ENTRY_TYPE)
            )
        );
        bytes32 structHash =
            keccak256(abi.encode(typeHash, c.certificateId, c.contentHash, c.deadline, keccak256(packed)));
        return keccak256(abi.encodePacked("\x19\x01", _ledgerDomainSeparator(ledger), structHash));
    }

    function _obligationKeyOf(bytes32 obligationId, address debtor, address creditor) internal pure returns (bytes32) {
        return keccak256(abi.encode(obligationId, debtor, creditor));
    }

    function _commitment(bytes32 obligationId, uint256 remaining, bytes32 blinding) internal pure returns (bytes32) {
        return keccak256(abi.encode(obligationId, remaining, blinding));
    }

    function _signDigest(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Same signer under raw ecrecover, but high-s — OZ's ECDSA must reject it.
    function _malleable(bytes memory sig) internal pure returns (bytes memory) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        return abi.encodePacked(r, bytes32(CURVE_ORDER - uint256(s)), v == 27 ? uint8(28) : uint8(27));
    }
}
