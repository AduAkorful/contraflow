// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IContraflowSettler
/// @notice Path/cycle validation and atomic multilateral netting. Never holds custody, never
/// calls a token contract, never restricts who may call `settle` — only whether the cycle
/// submitted is valid.
interface IContraflowSettler {
    /// @notice Emitted once per successful `settle` call, after every invoice in the cycle
    /// has been netted.
    event Settled(bytes32[] invoiceIds, uint256 wNet, address indexed caller);

    /// @notice `invoiceIds.length` was outside the Phase 1 bound of [3, 5].
    error CycleLengthInvalid(uint256 length);

    /// @notice `invoiceIds` is not a simple cycle: `creditor` of the invoice at `index` does
    /// not equal `debtor` of the next invoice in the array (wrapping at the end).
    error PathBroken(uint256 index);

    /// @notice The same invoice id appeared more than once in `invoiceIds`. Rejected outright
    /// rather than relying on the path check to catch it incidentally — see
    /// plans/01-registry-settler.md for why a repeated id would otherwise let one invoice
    /// absorb a multiple of `wNet` while the rest of the cycle only nets once, breaking the
    /// reciprocal, zero-cash guarantee the protocol depends on.
    error DuplicateInvoiceId(bytes32 id);

    /// @notice `wNet` was zero. A netting of zero value is not a valid cancel — rejected to
    /// avoid a permissionless, free way to spam `Settled`/`InvoiceNetted` events.
    error ZeroWNet();

    /// @notice A required address argument was the zero address.
    error ZeroAddress();

    /// @notice One-time setup for a freshly deployed proxy. Reverts if called a second time.
    /// @param registry_ The `ContraflowRegistry` this settler reads invoices from and nets through.
    /// @param owner_ Initial owner, authorized to call `_authorizeUpgrade`.
    function initialize(address registry_, address owner_) external;

    /// @notice Cancels `wNet` off every invoice in a simple directed cycle, in one transaction.
    /// @dev Reverts entirely on any failed check — no partial cancel. Permissionless: any
    /// address may call this if the cycle it submits is valid.
    /// @param invoiceIds Ids of the invoices forming the cycle, length in [3, 5], each distinct.
    /// @param wNet The amount subtracted from every invoice in the cycle; must be nonzero and
    /// no invoice may have less than `wNet` remaining.
    function settle(bytes32[] calldata invoiceIds, uint256 wNet) external;
}
