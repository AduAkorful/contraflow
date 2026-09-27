// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.36;

// Libraries
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

// Contracts
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Interfaces
import {
    IContraflowNettingLedger,
    CertificateEntry,
    NettingCertificate,
    NettingObligation
} from "./interfaces/IContraflowNettingLedger.sol";

/// @title ContraflowNettingLedger
/// @notice Hashes-only consumption ledger for Mode B offchain obligations. Never holds custody,
/// never calls a token, never sees an amount — it only advances blinded state commitments when
/// every party in a loop has signed the certificate doing so.
/// @dev UUPS-upgradeable behind the same single plain-`Ownable` operator EOA as
/// `ContraflowRegistry`/`ContraflowSettler`. Its EIP-712 domain name and types differ from the
/// Registry's, so a signature made for this ledger can never verify as an invoice attestation.
contract ContraflowNettingLedger is
    Initializable,
    EIP712Upgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    IContraflowNettingLedger
{
    uint256 private constant MIN_CYCLE_LENGTH = 2;
    uint256 private constant MAX_CYCLE_LENGTH = 5;

    bytes32 private constant NETTING_OBLIGATION_TYPEHASH = keccak256(
        "NettingObligation(bytes32 documentHash,address debtor,address creditor,string currency,uint256 amount,uint64 maturity,bool earlyNetConsent,bytes32 salt)"
    );

    bytes32 private constant CERTIFICATE_ENTRY_TYPEHASH = keccak256(
        "CertificateEntry(bytes32 obligationId,address debtor,address creditor,bytes32 priorCommitment,bytes32 nextCommitment)"
    );

    // EIP-712 requires referenced struct types to be appended to the primary type's encoding.
    bytes32 private constant NETTING_CERTIFICATE_TYPEHASH = keccak256(
        "NettingCertificate(bytes32 certificateId,bytes32 contentHash,uint64 deadline,CertificateEntry[] entries)CertificateEntry(bytes32 obligationId,address debtor,address creditor,bytes32 priorCommitment,bytes32 nextCommitment)"
    );

    mapping(bytes32 obligationKey => bytes32 commitment) private _state;
    mapping(bytes32 certificateId => bool applied) private _applied;

    /// @dev Reserved storage gap targeting a 50-slot budget alongside the 2 mappings above.
    /// Reduce this count, never renumber existing slots, whenever a future version appends a
    /// new state variable.
    uint256[48] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IContraflowNettingLedger
    function initialize(address owner_) external initializer {
        if (owner_ == address(0)) revert ZeroAddress();
        __EIP712_init("ContraflowNettingLedger", "1");
        __Ownable_init(owner_);
    }

    /// @inheritdoc IContraflowNettingLedger
    function applyCertificate(NettingCertificate calldata cert, bytes[] calldata signatures) external {
        CertificateEntry[] calldata entries = cert.entries;
        uint256 n = entries.length;

        if (cert.certificateId == bytes32(0)) revert ZeroCertificateId();
        if (block.timestamp > cert.deadline) revert CertificateExpired(cert.deadline, block.timestamp);
        if (_applied[cert.certificateId]) revert CertificateAlreadyApplied(cert.certificateId);
        if (n < MIN_CYCLE_LENGTH || n > MAX_CYCLE_LENGTH) revert CycleLengthInvalid(n);
        if (signatures.length != n) revert SignatureCountMismatch(n, signatures.length);

        // Pass 1 (checks): loop shape and commitment sanity, before any signature work. The path
        // rule plus distinct debtors also rule out a self-owed entry and a repeated obligation key,
        // even for a two-party loop, so neither needs a separate check.
        for (uint256 i = 0; i < n; ++i) {
            CertificateEntry calldata entry = entries[i];
            if (entry.debtor == address(0) || entry.creditor == address(0)) revert ZeroAddress();
            if (entry.creditor != entries[(i + 1) % n].debtor) revert PathBroken(i);
            for (uint256 j = 0; j < i; ++j) {
                if (entries[j].debtor == entry.debtor) revert DuplicateParty(entry.debtor);
            }
            if (entry.nextCommitment == bytes32(0)) revert ZeroCommitment(i);
            if (entry.nextCommitment == entry.priorCommitment) revert CommitmentUnchanged(i);
        }

        // Pass 2 (checks): every party signed this exact certificate. Each party is debtor on one
        // entry and creditor on the previous one, so n debtor signatures cover both parties of
        // every obligation.
        bytes32 digest = _certificateDigest(cert);
        for (uint256 i = 0; i < n; ++i) {
            address signer = entries[i].debtor;
            if (!_isValidSignature(signer, digest, signatures[i])) revert InvalidSignature(signer);
        }

        // Pass 3 (effects): compare-and-swap every obligation's commitment. No external calls
        // follow, and the only external calls above were ERC-1271 staticcalls.
        _applied[cert.certificateId] = true;
        for (uint256 i = 0; i < n; ++i) {
            CertificateEntry calldata entry = entries[i];
            bytes32 key = _obligationKey(entry.obligationId, entry.debtor, entry.creditor);
            bytes32 current = _state[key];
            if (current != entry.priorCommitment) revert StaleCommitment(key, current, entry.priorCommitment);
            _state[key] = entry.nextCommitment;
            emit ObligationAdvanced(key, cert.certificateId, entry.priorCommitment, entry.nextCommitment);
        }

        emit CertificateApplied(cert.certificateId, cert.contentHash, msg.sender);
    }

    /// @inheritdoc IContraflowNettingLedger
    function stateOf(bytes32 key) external view returns (bytes32 commitment) {
        commitment = _state[key];
    }

    /// @inheritdoc IContraflowNettingLedger
    function isApplied(bytes32 certificateId) external view returns (bool applied) {
        applied = _applied[certificateId];
    }

    /// @inheritdoc IContraflowNettingLedger
    function obligationKey(bytes32 obligationId_, address debtor, address creditor) external pure returns (bytes32 key) {
        key = _obligationKey(obligationId_, debtor, creditor);
    }

    /// @inheritdoc IContraflowNettingLedger
    function obligationId(NettingObligation calldata obligation) external view returns (bytes32 id) {
        id = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    NETTING_OBLIGATION_TYPEHASH,
                    obligation.documentHash,
                    obligation.debtor,
                    obligation.creditor,
                    keccak256(bytes(obligation.currency)),
                    obligation.amount,
                    obligation.maturity,
                    obligation.earlyNetConsent,
                    obligation.salt
                )
            )
        );
    }

    /// @inheritdoc IContraflowNettingLedger
    function certificateDigest(NettingCertificate calldata cert) external view returns (bytes32 digest) {
        digest = _certificateDigest(cert);
    }

    /// @notice The EIP-712 digest of a certificate, over every entry in order.
    function _certificateDigest(NettingCertificate calldata cert) internal view returns (bytes32) {
        CertificateEntry[] calldata entries = cert.entries;
        bytes32[] memory entryHashes = new bytes32[](entries.length);
        for (uint256 i = 0; i < entries.length; ++i) {
            entryHashes[i] = keccak256(
                abi.encode(
                    CERTIFICATE_ENTRY_TYPEHASH,
                    entries[i].obligationId,
                    entries[i].debtor,
                    entries[i].creditor,
                    entries[i].priorCommitment,
                    entries[i].nextCommitment
                )
            );
        }

        // EIP-712 encodes an array of structs as the keccak of its members' hashStructs
        // concatenated. encodePacked of a single bytes32[] is exactly that concatenation, with
        // no ambiguity since there's only one dynamic argument.
        bytes32 entriesHash = keccak256(abi.encodePacked(entryHashes));

        return _hashTypedDataV4(
            keccak256(abi.encode(NETTING_CERTIFICATE_TYPEHASH, cert.certificateId, cert.contentHash, cert.deadline, entriesHash))
        );
    }

    /// @notice ECDSA first, then ERC-1271 for signers with code. OZ's `isValidSignatureNow` goes
    /// straight to ERC-1271 whenever the signer has code, which would reject a genuine ECDSA
    /// signature from an EIP-7702-delegated EOA whose delegate doesn't answer ERC-1271 for a raw
    /// digest. Trying ECDSA first is safe for pure contracts: recovering to a contract's address
    /// needs a private key for it, which only exists when an EOA legitimately controls it.
    function _isValidSignature(address signer, bytes32 digest, bytes calldata signature) internal view returns (bool) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return true;
        return signer.code.length > 0 && SignatureChecker.isValidERC1271SignatureNowCalldata(signer, digest, signature);
    }

    /// @notice Binds an obligation's state to its two parties, so a certificate signed by anyone
    /// else addresses a different slot entirely.
    function _obligationKey(bytes32 obligationId_, address debtor, address creditor) internal pure returns (bytes32) {
        return keccak256(abi.encode(obligationId_, debtor, creditor));
    }

    /// @dev The entire upgrade gate. Empty body is intentional — `onlyOwner` is the whole check,
    /// per UUPSUpgradeable's documented pattern. Never remove `onlyOwner` here.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
