// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {InvoiceAttestation} from "../../src/interfaces/IContraflowRegistry.sol";

/// @notice Shared EIP-712 digest/signing helpers for Contraflow test suites. Reimplements the
/// domain separator and struct hash independently of ContraflowRegistry's own internal
/// `_hashInvoice`/`_hashTypedDataV4`, deliberately — a bug in the contract's own hashing must
/// not be masked by reusing the same (possibly buggy) logic to build test signatures.
abstract contract InvoiceSigningHelpers is Test {
    bytes32 internal constant INVOICE_TYPEHASH = keccak256(
        "InvoiceAttestation(bytes32 invoiceRef,uint256 amount,address currency,uint64 maturity,bool earlyNetConsent,address debtor,address creditor,uint256 nonce,address registry,uint256 chainId)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    // secp256k1 curve order n, sourced from OpenZeppelin's ECDSA.sol doc comment (not retyped
    // from memory) — used to construct a deliberately-malleable (high-S) signature in tests.
    uint256 internal constant SECP256K1N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _domainSeparator(address registryAddr) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("ContraflowRegistry")), keccak256(bytes("1")), block.chainid, registryAddr
            )
        );
    }

    function _digest(InvoiceAttestation memory inv, address registryAddr) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INVOICE_TYPEHASH,
                inv.invoiceRef,
                inv.amount,
                inv.currency,
                inv.maturity,
                inv.earlyNetConsent,
                inv.debtor,
                inv.creditor,
                inv.nonce,
                inv.registry,
                inv.chainId
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(registryAddr), structHash));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Flips a valid signature's `s` into the upper half order (and `v` accordingly) —
    /// mathematically still recovers the same signer via raw `ecrecover`, but OZ's ECDSA
    /// library must reject it outright as malleable, before recovery is even attempted.
    function _makeMalleable(bytes memory sig) internal pure returns (bytes memory) {
        require(sig.length == 65, "bad fixture sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        bytes32 sHigh = bytes32(SECP256K1N - uint256(s));
        uint8 vFlipped = v == 27 ? 28 : 27;
        return abi.encodePacked(r, sHigh, vFlipped);
    }
}
