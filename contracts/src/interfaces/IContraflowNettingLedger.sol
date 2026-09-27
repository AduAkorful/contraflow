// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.36;

/// @notice One obligation's step inside a netting certificate. The ledger never learns the
/// obligation's amount, currency or document — only its opaque id, its two parties, and the
/// blinded state commitment before and after this certificate.
struct CertificateEntry {
    /// @dev EIP-712 digest of the `NettingObligation` both parties signed offchain.
    bytes32 obligationId;
    address debtor;
    address creditor;
    /// @dev The obligation's current commitment on the ledger; `bytes32(0)` if it has never been netted.
    bytes32 priorCommitment;
    /// @dev `keccak256(abi.encode(obligationId, remaining, blinding))` with a fresh random blinding.
    bytes32 nextCommitment;
}

/// @notice A proposal to net every obligation in a closed loop, signed by every party in it.
struct NettingCertificate {
    bytes32 certificateId;
    /// @dev Hash of the full offchain certificate document (amounts, wNet, obligations,
    /// signatures, blindings), so signing commits each party to the exact computation.
    bytes32 contentHash;
    uint64 deadline;
    CertificateEntry[] entries;
}

/// @notice An offchain debt both parties signed. Never stored or checked onchain; the ledger
/// only exposes its typed-data hashing so offchain code can be verified against it.
struct NettingObligation {
    bytes32 documentHash;
    address debtor;
    address creditor;
    /// @dev ISO 4217 currency code, e.g. "USD".
    string currency;
    /// @dev In the currency's ISO 4217 minor units (cents for USD).
    uint256 amount;
    uint64 maturity;
    bool earlyNetConsent;
    bytes32 salt;
}

/// @title IContraflowNettingLedger
/// @notice Hashes-only consumption ledger for Mode B offchain obligations. Each obligation has
/// one blinded state commitment, advanced only by a netting certificate that every party in the
/// loop signed, so no obligation can be netted twice. Holds no custody, never touches a token,
/// never sees amounts, and does not restrict who may submit a signed certificate.
interface IContraflowNettingLedger {
    /// @notice Emitted once per applied certificate, after every obligation in it advanced.
    event CertificateApplied(bytes32 indexed certificateId, bytes32 contentHash, address indexed submitter);

    /// @notice Emitted per obligation when its state commitment advances.
    event ObligationAdvanced(
        bytes32 indexed obligationKey, bytes32 indexed certificateId, bytes32 priorCommitment, bytes32 nextCommitment
    );

    /// @notice A required address was the zero address.
    error ZeroAddress();

    /// @notice `certificateId` was zero.
    error ZeroCertificateId();

    /// @notice The certificate's `deadline` has passed.
    error CertificateExpired(uint64 deadline, uint256 nowTimestamp);

    /// @notice A certificate with this id was already applied.
    error CertificateAlreadyApplied(bytes32 certificateId);

    /// @notice The loop had fewer than 2 or more than 5 obligations.
    error CycleLengthInvalid(uint256 length);

    /// @notice There must be exactly one signature per entry.
    error SignatureCountMismatch(uint256 entries, uint256 signatures);

    /// @notice `creditor` of the entry at `index` is not `debtor` of the next entry (wrapping at the end).
    error PathBroken(uint256 index);

    /// @notice The same party is debtor on more than one entry; a loop visits each party once.
    error DuplicateParty(address party);

    /// @notice `signer`'s signature over the certificate digest was not valid.
    error InvalidSignature(address signer);

    /// @notice The entry at `index` would set a zero commitment, which is reserved for "never netted".
    error ZeroCommitment(uint256 index);

    /// @notice The entry at `index` does not advance its obligation's state.
    error CommitmentUnchanged(uint256 index);

    /// @notice The certificate was built on a state the obligation is no longer in.
    error StaleCommitment(bytes32 obligationKey, bytes32 current, bytes32 provided);

    /// @notice One-time setup for a freshly deployed proxy. Reverts if called a second time.
    /// @param owner_ Initial owner, authorized to upgrade the implementation.
    function initialize(address owner_) external;

    /// @notice Advances every obligation in a signed loop, or reverts entirely.
    /// @dev Permissionless. Requires 2–5 entries forming a closed loop of distinct parties, one
    /// valid signature per entry by that entry's debtor over `certificateDigest(cert)` (ECDSA, or
    /// ERC-1271 for a smart account), each entry's `priorCommitment` equal to the obligation's
    /// current commitment, and a nonzero `nextCommitment` different from it. In a loop every
    /// party is debtor on one entry and creditor on another, so the signatures cover both parties
    /// of every obligation.
    /// @param cert The certificate to apply.
    /// @param signatures `signatures[i]` is `cert.entries[i].debtor`'s signature.
    function applyCertificate(NettingCertificate calldata cert, bytes[] calldata signatures) external;

    /// @notice The current state commitment for `key`; zero if never netted.
    function stateOf(bytes32 key) external view returns (bytes32 commitment);

    /// @notice Whether a certificate with this id has been applied.
    function isApplied(bytes32 certificateId) external view returns (bool applied);

    /// @notice The storage key binding an obligation to its two parties, so no one else's
    /// signatures can ever reach its state.
    function obligationKey(bytes32 obligationId_, address debtor, address creditor) external pure returns (bytes32 key);

    /// @notice The EIP-712 digest both parties sign for an obligation, which is also its id.
    function obligationId(NettingObligation calldata obligation) external view returns (bytes32 id);

    /// @notice The EIP-712 digest every party signs for a certificate.
    function certificateDigest(NettingCertificate calldata cert) external view returns (bytes32 digest);
}
