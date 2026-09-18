// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Contracts
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

// Interfaces
import {IContraflowSettler} from "../../../src/interfaces/IContraflowSettler.sol";
import {IContraflowRegistry, Invoice} from "../../../src/interfaces/IContraflowRegistry.sol";

/// @title ContraflowSettlerV2
/// @notice REHEARSAL ONLY — see ContraflowRegistryV2.sol's header for the full rationale
/// (plans/03-live-testnet-e2e-tests.md §6). Full standalone copy of `ContraflowSettler.sol`,
/// `__gap` shrunk 49->48, `totalSettleCalls` appended in the reclaimed slot, one line added at
/// the end of `settle` to increment it. Never deployed to mainnet.
contract ContraflowSettlerV2 is Initializable, OwnableUpgradeable, UUPSUpgradeable, IContraflowSettler {
    uint256 private constant MIN_CYCLE_LENGTH = 3;
    uint256 private constant MAX_CYCLE_LENGTH = 5;

    /// @notice The registry this settler reads invoices from and nets through.
    address public registry;

    /// @notice NEW in V2 (rehearsal). Count of successful settle() calls while this
    /// implementation was active.
    uint256 public totalSettleCalls;

    /// @dev Shrunk 49->48 to make room for `totalSettleCalls` above.
    uint256[48] private __gap;

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

        for (uint256 i = 0; i < n; ++i) {
            bytes32 id = invoiceIds[i];
            for (uint256 j = 0; j < i; ++j) {
                if (invoiceIds[j] == id) revert DuplicateInvoiceId(id);
            }
            invoices[i] = reg.getInvoice(id);
        }

        for (uint256 i = 0; i < n; ++i) {
            uint256 next = (i + 1) % n;
            if (invoices[i].creditor != invoices[next].debtor) revert PathBroken(i);
        }

        for (uint256 i = 0; i < n; ++i) {
            reg.netInvoice(invoiceIds[i], wNet);
        }

        // NEW in V2 (rehearsal). Added last, after every existing check/effect.
        totalSettleCalls += 1;

        emit Settled(invoiceIds, wNet, msg.sender);
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
