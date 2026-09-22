// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.37;

/// @notice Onchain status of a registered invoice.
enum InvoiceStatus {
    Active,
    ExtinguishedOnchain
}

/// @notice EIP-712 typed payload both the debtor and creditor sign to attest an invoice.
/// @dev Both parties sign the exact same struct — see IContraflowRegistry.register.
struct InvoiceAttestation {
    bytes32 invoiceRef;
    uint256 amount;
    address currency;
    uint64 maturity;
    bool earlyNetConsent;
    address debtor;
    address creditor;
    uint256 nonce;
    address registry;
    uint256 chainId;
}

/// @notice Canonical onchain record for a registered invoice.
/// @dev Field order is deliberate, not declaration-convenience: `debtor` + `maturity` +
/// `earlyNetConsent` + `status` pack into a single 32-byte slot, `creditor` and
/// `amountRemaining` and `nonce` each take their own — 4 slots total instead of 6 laid out
/// in signature-mirroring order. This struct is a mapping value already live on mainnet
/// once deployed; reordering after that would silently reinterpret every stored invoice, so
/// this packing is fixed for the life of this interface version.
struct Invoice {
    address debtor;
    uint64 maturity;
    bool earlyNetConsent;
    InvoiceStatus status;
    address creditor;
    uint256 amountRemaining;
    uint256 nonce;
}

/// @title IContraflowRegistry
/// @notice Stores bilaterally-signed invoices and the only storage in the protocol
/// that can reduce `amountRemaining`. Holds no custody and never transfers a token.
interface IContraflowRegistry {
    /// @notice Emitted when a new invoice is registered.
    event InvoiceRegistered(
        bytes32 indexed id,
        address indexed debtor,
        address indexed creditor,
        uint256 amount,
        uint64 maturity,
        bool earlyNetConsent,
        uint256 nonce
    );

    /// @notice Emitted each time an invoice's remaining amount is reduced by the settler.
    event InvoiceNetted(bytes32 indexed id, uint256 wNet, uint256 remainingAfter, InvoiceStatus status);

    /// @notice `debtorSignature` or `creditorSignature` did not recover to `expectedSigner`.
    error InvalidSignature(address expectedSigner);

    /// @notice `provided` nonce is not exactly one greater than the last nonce used for this
    /// (debtor, creditor) pair — i.e. not equal to `expected`. Nonces must be registered back
    /// to back with no gaps: a merely-increasing (not necessarily consecutive) check would let
    /// whichever invoice's `register()` call lands first permanently burn every lower,
    /// unregistered nonce for that pair, including a fully bilaterally-signed one that simply
    /// lost an ordinary mempool-ordering race.
    error NonceNotSequential(uint256 provided, uint256 expected);

    /// @notice Invoice currency is not the canonical Arc ERC-20 USDC address.
    error CurrencyMismatch(address provided, address expected);

    /// @notice Invoice's `registry` field does not match this contract's address.
    error RegistryMismatch(address provided, address expected);

    /// @notice Invoice's `chainId` field does not match `block.chainid`.
    error ChainIdMismatch(uint256 provided, uint256 expected);

    /// @notice Invoice amount was zero.
    error ZeroAmount();

    /// @notice A required address argument was the zero address.
    error ZeroAddress();

    /// @notice `debtor` and `creditor` were the same address.
    error SelfInvoice(address party);

    /// @notice An invoice with this exact id (attestation content + nonce) already exists.
    error InvoiceAlreadyRegistered(bytes32 id);

    /// @notice No invoice is registered under `id`.
    error InvoiceNotFound(bytes32 id);

    /// @notice Caller of `netInvoice` was not the wired settler contract.
    error NotSettler(address caller);

    /// @notice Invoice is not `Active` (already fully netted).
    error InvoiceNotActive(bytes32 id);

    /// @notice Invoice is neither matured nor early-net-consented.
    error InvoiceNotNettable(bytes32 id);

    /// @notice `wNet` exceeds the invoice's current `amountRemaining`.
    error AmountExceedsRemaining(bytes32 id, uint256 wNet, uint256 remaining);

    /// @notice One-time setup for a freshly deployed proxy. Reverts if called a second time.
    /// @param usdcToken_ Canonical Arc ERC-20 USDC address; every invoice's `currency` must match it.
    /// @param settler_ The only address ever permitted to call `netInvoice`.
    /// @param owner_ Initial owner, authorized to call `_authorizeUpgrade` via `Ownable2Step`.
    function initialize(address usdcToken_, address settler_, address owner_) external;

    /// @notice Registers a bilaterally-signed invoice.
    /// @dev Reverts on any validation failure; never partially stores an invoice.
    /// @param invoice The attestation payload both parties signed.
    /// @param debtorSignature ECDSA signature over the EIP-712 digest of `invoice`, by `invoice.debtor`.
    /// @param creditorSignature ECDSA signature over the same digest, by `invoice.creditor`.
    /// @return id The invoice id (equal to the EIP-712 digest that was signed).
    function register(InvoiceAttestation calldata invoice, bytes calldata debtorSignature, bytes calldata creditorSignature)
        external
        returns (bytes32 id);

    /// @notice Reads an invoice's current onchain state.
    /// @dev Reverts InvoiceNotFound if `id` was never registered.
    function getInvoice(bytes32 id) external view returns (Invoice memory);

    /// @notice Reduces an invoice's `amountRemaining` by `wNet`. Callable only by the settler.
    /// @dev The only function in the protocol that mutates `amountRemaining` or `status`.
    /// @return remainingAfter `amountRemaining` after the reduction.
    function netInvoice(bytes32 id, uint256 wNet) external returns (uint256 remainingAfter);
}
