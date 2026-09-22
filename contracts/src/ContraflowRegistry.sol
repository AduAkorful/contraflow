// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.37;

// Libraries
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// Contracts
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Interfaces
import {IContraflowRegistry, InvoiceAttestation, Invoice, InvoiceStatus} from "./interfaces/IContraflowRegistry.sol";

/// @title ContraflowRegistry
/// @notice Canonical onchain store of bilaterally-signed invoices. Holds no custody and never
/// transfers a token — `amountRemaining` only ever moves via `netInvoice`, called by the settler.
/// @dev UUPS-upgradeable (spec 3.3.0, reversing the original non-upgradeable decision). Upgrade
/// authority is a single Ownable-controlled EOA in Phase 1 — plain single-step `Ownable`, not
/// `Ownable2Step`, per explicit operator instruction (a deliberate deviation from this repo's
/// usual security-first default, which prefers Ownable2Step). See plans/contraflow-spec.md §5
/// for exactly what that key can and cannot do. `usdc` and `settler` are regular storage, not
/// `immutable`, because they are set in `initialize()` on the proxy, not in this contract's own
/// constructor — immutables can only be assigned during the constructor of the exact contract
/// whose bytecode is executing, which a proxy's delegatecall never runs.
contract ContraflowRegistry is Initializable, EIP712Upgradeable, OwnableUpgradeable, UUPSUpgradeable, IContraflowRegistry {
    using ECDSA for bytes32;

    bytes32 private constant INVOICE_TYPEHASH = keccak256(
        "InvoiceAttestation(bytes32 invoiceRef,uint256 amount,address currency,uint64 maturity,bool earlyNetConsent,address debtor,address creditor,uint256 nonce,address registry,uint256 chainId)"
    );

    mapping(bytes32 id => Invoice) private _invoices;
    mapping(address debtor => mapping(address creditor => uint256 lastNonce)) private _lastNonce;

    /// @notice Canonical Arc ERC-20 USDC address every invoice's `currency` must equal.
    address public usdc;

    /// @notice The only address permitted to call `netInvoice`.
    address public settler;

    /// @dev Reserved storage gap targeting a 50-slot budget alongside the 4 slots declared
    /// above (2 mappings + 2 addresses). Reduce this count, never renumber existing slots,
    /// whenever a future version appends a new state variable.
    uint256[46] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IContraflowRegistry
    function initialize(address usdcToken_, address settler_, address owner_) external initializer {
        if (usdcToken_ == address(0) || settler_ == address(0) || owner_ == address(0)) revert ZeroAddress();

        __EIP712_init("ContraflowRegistry", "1");
        __Ownable_init(owner_);

        usdc = usdcToken_;
        settler = settler_;
    }

    /// @inheritdoc IContraflowRegistry
    function register(
        InvoiceAttestation calldata invoice,
        bytes calldata debtorSignature,
        bytes calldata creditorSignature
    ) external returns (bytes32 id) {
        if (invoice.currency != usdc) revert CurrencyMismatch(invoice.currency, usdc);
        if (invoice.registry != address(this)) revert RegistryMismatch(invoice.registry, address(this));
        if (invoice.chainId != block.chainid) revert ChainIdMismatch(invoice.chainId, block.chainid);
        if (invoice.amount == 0) revert ZeroAmount();
        if (invoice.debtor == address(0) || invoice.creditor == address(0)) revert ZeroAddress();
        if (invoice.debtor == invoice.creditor) revert SelfInvoice(invoice.debtor);

        id = _hashTypedDataV4(_hashInvoice(invoice));

        if (_invoices[id].debtor != address(0)) revert InvoiceAlreadyRegistered(id);

        // ECDSA.recoverCalldata reverts (ECDSAInvalidSignature / ECDSAInvalidSignatureLength /
        // ECDSAInvalidSignatureS) on a malformed or malleable signature before we ever get to
        // compare signers below — that revert is intentional defense, not a gap in this check.
        address recoveredDebtor = id.recoverCalldata(debtorSignature);
        if (recoveredDebtor != invoice.debtor) revert InvalidSignature(invoice.debtor);

        address recoveredCreditor = id.recoverCalldata(creditorSignature);
        if (recoveredCreditor != invoice.creditor) revert InvalidSignature(invoice.creditor);

        // Strictly sequential, never allowed to skip: the zero value of an unused mapping slot
        // means the first invoice ever registered for a (debtor, creditor) pair must use nonce
        // 1. A merely-increasing (nonce > lastNonce) check would let whichever invoice's
        // register() call lands first permanently burn every unregistered nonce below it —
        // including a legitimate, fully bilaterally-signed invoice that simply lost an ordinary
        // mempool-ordering race, not an attack. Requiring the exact next nonce removes that
        // race entirely: no nonce for a pair can ever be skipped or superseded by arrival order.
        uint256 lastNonce = _lastNonce[invoice.debtor][invoice.creditor];
        if (invoice.nonce != lastNonce + 1) revert NonceNotSequential(invoice.nonce, lastNonce + 1);
        _lastNonce[invoice.debtor][invoice.creditor] = invoice.nonce;

        _invoices[id] = Invoice({
            debtor: invoice.debtor,
            maturity: invoice.maturity,
            earlyNetConsent: invoice.earlyNetConsent,
            status: InvoiceStatus.Active,
            creditor: invoice.creditor,
            amountRemaining: invoice.amount,
            nonce: invoice.nonce
        });

        emit InvoiceRegistered(
            id, invoice.debtor, invoice.creditor, invoice.amount, invoice.maturity, invoice.earlyNetConsent, invoice.nonce
        );
    }

    /// @inheritdoc IContraflowRegistry
    function getInvoice(bytes32 id) external view returns (Invoice memory invoice) {
        invoice = _invoices[id];
        if (invoice.debtor == address(0)) revert InvoiceNotFound(id);
    }

    /// @inheritdoc IContraflowRegistry
    function netInvoice(bytes32 id, uint256 wNet) external returns (uint256 remainingAfter) {
        if (msg.sender != settler) revert NotSettler(msg.sender);

        Invoice storage invoice = _invoices[id];
        if (invoice.debtor == address(0)) revert InvoiceNotFound(id);
        if (invoice.status != InvoiceStatus.Active) revert InvoiceNotActive(id);
        if (block.timestamp < invoice.maturity && !invoice.earlyNetConsent) revert InvoiceNotNettable(id);
        if (wNet > invoice.amountRemaining) revert AmountExceedsRemaining(id, wNet, invoice.amountRemaining);

        unchecked {
            // safe: wNet <= amountRemaining was just checked above, so this cannot underflow.
            invoice.amountRemaining -= wNet;
        }
        remainingAfter = invoice.amountRemaining;

        if (remainingAfter == 0) {
            invoice.status = InvoiceStatus.ExtinguishedOnchain;
        }

        emit InvoiceNetted(id, wNet, remainingAfter, invoice.status);
    }

    /// @dev The entire upgrade gate. Empty body is intentional — `onlyOwner` is the whole check,
    /// per UUPSUpgradeable's documented pattern. Never remove `onlyOwner` here.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

    /// @dev Split out of `register` solely to keep that function's stack shallow enough to
    /// compile without `via-ir` — passing the whole struct in one shot avoids holding all ten
    /// scalar fields live on the stack simultaneously alongside `register`'s other locals.
    function _hashInvoice(InvoiceAttestation calldata invoice) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                INVOICE_TYPEHASH,
                invoice.invoiceRef,
                invoice.amount,
                invoice.currency,
                invoice.maturity,
                invoice.earlyNetConsent,
                invoice.debtor,
                invoice.creditor,
                invoice.nonce,
                invoice.registry,
                invoice.chainId
            )
        );
    }
}
