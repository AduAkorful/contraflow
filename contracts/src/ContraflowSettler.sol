// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Contracts
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Interfaces
import {IContraflowSettler} from "./interfaces/IContraflowSettler.sol";
import {IContraflowRegistry, Invoice} from "./interfaces/IContraflowRegistry.sol";

/// @title ContraflowSettler
/// @notice Validates a proposed netting cycle and atomically subtracts `wNet` from every
/// invoice in it via the registry. Never holds custody, never calls a token contract, never
/// restricts who may call `settle` — only whether the cycle submitted is valid.
/// @dev UUPS-upgradeable (spec 3.3.0). Upgrade authority is a single plain-Ownable-controlled
/// EOA in Phase 1, same deliberate deviation from the Ownable2Step default as ContraflowRegistry.
/// `registry` is regular storage, not `immutable`, for the same reason as ContraflowRegistry's
/// `usdc`/`settler`: it is set in `initialize()` on the proxy, which a constructor never runs.
contract ContraflowSettler is Initializable, OwnableUpgradeable, UUPSUpgradeable, IContraflowSettler {
    uint256 private constant MIN_CYCLE_LENGTH = 3;
    uint256 private constant MAX_CYCLE_LENGTH = 5;

    /// @notice The registry this settler reads invoices from and nets through.
    address public registry;

    /// @dev Reserved storage gap targeting a 50-slot budget alongside the 1 slot declared
    /// above. Reduce this count, never renumber existing slots, whenever a future version
    /// appends a new state variable.
    uint256[49] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IContraflowSettler
    function initialize(address registry_, address owner_) external initializer {
        if (registry_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        __Ownable_init(owner_);
        registry = registry_;
    }

    /// @inheritdoc IContraflowSettler
    function settle(bytes32[] calldata invoiceIds, uint256 wNet) external {
        uint256 n = invoiceIds.length;
        if (n < MIN_CYCLE_LENGTH || n > MAX_CYCLE_LENGTH) revert CycleLengthInvalid(n);
        if (wNet == 0) revert ZeroWNet();

        IContraflowRegistry reg = IContraflowRegistry(registry);
        Invoice[] memory invoices = new Invoice[](n);

        // Pass 1 (checks): read every invoice and reject a repeated id before it can cause one
        // invoice to be netted more than once in pass 3 — see IContraflowSettler.DuplicateInvoiceId.
        for (uint256 i = 0; i < n; ++i) {
            bytes32 id = invoiceIds[i];
            for (uint256 j = 0; j < i; ++j) {
                if (invoiceIds[j] == id) revert DuplicateInvoiceId(id);
            }
            invoices[i] = reg.getInvoice(id);
        }

        // Pass 2 (checks): confirm the invoices form a single simple directed cycle. Needs a
        // separate pass from the read above — checking creditor[i] == debtor[i+1] requires
        // invoices[i+1] to already be populated, which isn't guaranteed mid-read for any i
        // other than the final wraparound.
        for (uint256 i = 0; i < n; ++i) {
            uint256 next = (i + 1) % n;
            if (invoices[i].creditor != invoices[next].debtor) revert PathBroken(i);
        }

        // Pass 3 (effects): the registry re-validates active/remaining/nettable per invoice
        // and performs the actual subtraction. Any single failure reverts this whole
        // transaction via ordinary Solidity revert propagation — no partial cancel.
        for (uint256 i = 0; i < n; ++i) {
            reg.netInvoice(invoiceIds[i], wNet);
        }

        emit Settled(invoiceIds, wNet, msg.sender);
    }

    /// @dev The entire upgrade gate. Empty body is intentional — `onlyOwner` is the whole check,
    /// per UUPSUpgradeable's documented pattern. Never remove `onlyOwner` here.
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
