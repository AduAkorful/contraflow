// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ContraflowRegistry} from "../../../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../../../src/ContraflowSettler.sol";
import {MockUSDC} from "../../mocks/MockUSDC.sol";
import {InvoiceAttestation} from "../../../src/interfaces/IContraflowRegistry.sol";
import {InvoiceSigningHelpers} from "../../helpers/InvoiceSigningHelpers.sol";

/// @notice Drives bounded-but-valid random call sequences against the real Registry + Settler
/// for Foundry's stateful invariant runner. Deliberately biased toward VALID actions (a fixed
/// pool of parties, always-matured/always-consented invoices, nonces tracked so they're always
/// legal) — this handler's job is to stress the accounting/status machinery with deep, mostly
/// successful sequences, not to re-prove revert conditions the unit and integration suites
/// already cover exhaustively.
contract ContraflowHandler is InvoiceSigningHelpers {
    uint256 public constant PARTY_POOL_SIZE = 6;

    ContraflowRegistry public registry;
    ContraflowSettler public settler;
    MockUSDC public usdc;

    address[PARTY_POOL_SIZE] public partyAddr;
    uint256[PARTY_POOL_SIZE] public partyKey;
    mapping(address => mapping(address => uint256)) public lastNonce;

    struct Cycle {
        bytes32[] ids;
    }

    Cycle[] internal _cycles;

    // Ghost accounting, read by the invariant assertions.
    uint256 public ghost_totalRegistered;
    uint256 public ghost_totalNetted;
    uint256 public ghost_registerCallCount;
    uint256 public ghost_settleCallCount;
    uint256 public ghost_settleNoOpCount;

    constructor(ContraflowRegistry registry_, ContraflowSettler settler_, MockUSDC usdc_) {
        registry = registry_;
        settler = settler_;
        usdc = usdc_;
        for (uint256 i = 0; i < PARTY_POOL_SIZE; ++i) {
            (partyAddr[i], partyKey[i]) = makeAddrAndKey(string.concat("handler-party-", vm.toString(i)));
        }
    }

    function cycleCount() external view returns (uint256) {
        return _cycles.length;
    }

    function cycleIds(uint256 cycleIndex) external view returns (bytes32[] memory) {
        return _cycles[cycleIndex].ids;
    }

    /// @dev Registers a fresh n-party cycle (n in [3,5]) walking consecutively through the
    /// fixed party pool starting at a random offset, every edge the same bounded random
    /// amount, maturity in the past and earlyNetConsent true so it's immediately nettable —
    /// keeps handler_settle simple and mostly-successful.
    function handler_registerCycle(uint256 nSeed, uint256 amountSeed, uint256 startSeed) external {
        uint256 n = bound(nSeed, 3, 5);
        uint256 amount = bound(amountSeed, 1, 1_000_000e6);
        uint256 start = bound(startSeed, 0, PARTY_POOL_SIZE - 1);

        bytes32[] memory ids = new bytes32[](n);
        for (uint256 i = 0; i < n; ++i) {
            // The creditor of edge i must be the debtor of edge (i+1) MOD n — wrapping back to
            // position 0 of THIS cycle after n steps, not advancing to a fresh, (n+1)-th pool
            // member. Using `% PARTY_POOL_SIZE` for the creditor offset (as an earlier version
            // of this handler did) advances one full extra pool slot past the cycle's own
            // start and never closes the loop, since n < PARTY_POOL_SIZE always — Settler
            // correctly rejects that as PathBroken, which is how this bug was actually found.
            uint256 dIdx = (start + i) % PARTY_POOL_SIZE;
            uint256 cIdx = (start + ((i + 1) % n)) % PARTY_POOL_SIZE;
            // PARTY_POOL_SIZE (6) > MAX_CYCLE_LENGTH (5) guarantees dIdx != cIdx for any valid
            // n, but guard explicitly rather than relying on that arithmetic staying true.
            if (dIdx == cIdx) return;

            address debtorAddr = partyAddr[dIdx];
            address creditorAddr = partyAddr[cIdx];
            uint256 nonce = ++lastNonce[debtorAddr][creditorAddr];

            InvoiceAttestation memory inv = InvoiceAttestation({
                invoiceRef: keccak256(abi.encode(debtorAddr, creditorAddr, nonce, block.timestamp, i)),
                amount: amount,
                currency: address(usdc),
                maturity: uint64(block.timestamp),
                earlyNetConsent: true,
                debtor: debtorAddr,
                creditor: creditorAddr,
                nonce: nonce,
                registry: address(registry),
                chainId: block.chainid
            });
            bytes32 digest = _digest(inv, address(registry));
            ids[i] = registry.register(inv, _sign(partyKey[dIdx], digest), _sign(partyKey[cIdx], digest));
        }

        _cycles.push(Cycle({ids: ids}));
        ghost_totalRegistered += amount * n;
        ghost_registerCallCount++;
    }

    /// @dev Picks a previously-registered cycle and nets a bounded amount off it. A no-op
    /// (tracked, not reverted) if no cycles exist yet or the picked one is already fully
    /// extinguished — both are expected steady states, not failures.
    function handler_settle(uint256 cycleSeed, uint256 wNetSeed) external {
        if (_cycles.length == 0) {
            ghost_settleNoOpCount++;
            return;
        }
        uint256 idx = bound(cycleSeed, 0, _cycles.length - 1);
        bytes32[] memory ids = _cycles[idx].ids;

        uint256 remaining = registry.getInvoice(ids[0]).amountRemaining;
        if (remaining == 0) {
            ghost_settleNoOpCount++;
            return;
        }

        uint256 wNet = bound(wNetSeed, 1, remaining);
        settler.settle(ids, wNet);

        ghost_totalNetted += wNet * ids.length;
        ghost_settleCallCount++;
    }
}
