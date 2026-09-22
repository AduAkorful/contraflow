// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// Libraries
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

// Contracts
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {EIP712Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Interfaces
import {IContraflowRegistry, InvoiceAttestation, Invoice, InvoiceStatus} from "../../../src/interfaces/IContraflowRegistry.sol";

/// @title ContraflowRegistryV2
/// @notice REHEARSAL ONLY — not part of the shipped Phase 1 protocol. Written for
/// plans/03-live-testnet-e2e-tests.md §6, to prove a real append-plus-gap-shrink storage
/// evolution survives a live upgrade, closing the gap the 2026-09-18 adversarial audit flagged:
/// the existing `ContraflowRegistryV2Mock` (contracts/test/mocks/) inherits from V1 rather than
/// being a full standalone copy, so it never actually exercises shrinking `__gap` — inheritance
/// just appends new storage after the *entire* untouched gap. This file is a full copy of
/// `ContraflowRegistry.sol` with exactly one intentional change: `__gap` shrunk 46->45 and
/// `totalInvoicesRegistered` appended in the reclaimed slot, per this repo's upgrade-safety
/// checklist. All other logic is byte-for-byte identical except the one line inside `register`
/// that increments the new counter, added last so it cannot change any existing revert path's
/// ordering or behavior.
/// @dev Never deployed to mainnet. If this rehearsal is later judged worth keeping as a real
/// upgrade, it should be promoted into `contracts/src/` and re-reviewed as such, not treated as
/// already-shipped because this file compiled and ran once on testnet.
contract ContraflowRegistryV2 is Initializable, EIP712Upgradeable, OwnableUpgradeable, UUPSUpgradeable, IContraflowRegistry {
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

    /// @notice NEW in V2 (rehearsal). Count of invoices registered while this implementation
    /// was active. Appended here, in the slot reclaimed by shrinking `__gap`, not at the end
    /// after the untouched gap — this is the part the inheritance-based mocks didn't exercise.
    uint256 public totalInvoicesRegistered;

    /// @dev Shrunk 46->45 to make room for `totalInvoicesRegistered` above. Reduce further,
    /// never renumber existing slots, whenever a future version appends another variable.
    uint256[45] private __gap;

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

        address recoveredDebtor = id.recoverCalldata(debtorSignature);
        if (recoveredDebtor != invoice.debtor) revert InvalidSignature(invoice.debtor);

        address recoveredCreditor = id.recoverCalldata(creditorSignature);
        if (recoveredCreditor != invoice.creditor) revert InvalidSignature(invoice.creditor);

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

        // NEW in V2 (rehearsal). Added last, after every existing check/effect, so it cannot
        // change any pre-existing revert path's ordering or behavior.
        totalInvoicesRegistered += 1;

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
            invoice.amountRemaining -= wNet;
        }
        remainingAfter = invoice.amountRemaining;

        if (remainingAfter == 0) {
            invoice.status = InvoiceStatus.ExtinguishedOnchain;
        }

        emit InvoiceNetted(id, wNet, remainingAfter, invoice.status);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}

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
