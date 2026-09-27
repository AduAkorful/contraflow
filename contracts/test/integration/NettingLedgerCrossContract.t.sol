// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ContraflowRegistry} from "../../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../../src/ContraflowSettler.sol";
import {ContraflowNettingLedger} from "../../src/ContraflowNettingLedger.sol";
import {IContraflowRegistry, InvoiceAttestation} from "../../src/interfaces/IContraflowRegistry.sol";
import {
    IContraflowNettingLedger,
    CertificateEntry,
    NettingCertificate,
    NettingObligation
} from "../../src/interfaces/IContraflowNettingLedger.sol";
import {MockUSDC} from "../mocks/MockUSDC.sol";
import {InvoiceSigningHelpers} from "../helpers/InvoiceSigningHelpers.sol";
import {ContraflowDeployHelpers} from "../helpers/ContraflowDeployHelpers.sol";
import {NettingSigningHelpers} from "../helpers/NettingSigningHelpers.sol";

/// @notice Proves Mode A and Mode B signatures can't be swapped: an offchain obligation both
/// parties signed can never be registered as a USDC invoice, and an invoice signature can never
/// approve a netting certificate. This holds by construction (different EIP-712 domain and types),
/// not because the app happens not to submit them.
contract NettingLedgerCrossContractTest is InvoiceSigningHelpers, ContraflowDeployHelpers, NettingSigningHelpers {
    ContraflowRegistry internal registry;
    ContraflowSettler internal settler;
    ContraflowNettingLedger internal ledger;
    MockUSDC internal usdc;

    address internal debtor;
    uint256 internal debtorKey;
    address internal creditor;
    uint256 internal creditorKey;

    function setUp() public {
        usdc = new MockUSDC();
        (registry, settler) = _deployContraflow(address(usdc), makeAddr("owner"));
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        ledger = ContraflowNettingLedger(
            address(
                new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowNettingLedger.initialize, (makeAddr("owner"))))
            )
        );
        (debtor, debtorKey) = makeAddrAndKey("debtor");
        (creditor, creditorKey) = makeAddrAndKey("creditor");
    }

    /// @dev An invoice and an obligation describing the same debt, field for field where the
    /// types overlap — the most favourable case for an attacker trying to reuse signatures.
    function _matchingPair() internal view returns (InvoiceAttestation memory inv, NettingObligation memory ob) {
        bytes32 doc = keccak256("invoice INV-7 for 1,000.00");
        inv = InvoiceAttestation({
            invoiceRef: doc,
            amount: 1_000_000_000,
            currency: address(usdc),
            maturity: 0,
            earlyNetConsent: true,
            debtor: debtor,
            creditor: creditor,
            nonce: 1,
            registry: address(registry),
            chainId: block.chainid
        });
        ob = NettingObligation({
            documentHash: doc,
            debtor: debtor,
            creditor: creditor,
            currency: "USD",
            amount: 1_000_000_000,
            maturity: 0,
            earlyNetConsent: true,
            salt: bytes32(0)
        });
    }

    function test_register_rejectsModeBObligationSignatures() public {
        (InvoiceAttestation memory inv, NettingObligation memory ob) = _matchingPair();
        bytes32 obligationDigest = ledger.obligationId(ob);

        bytes memory debtorSig = _signDigest(debtorKey, obligationDigest);
        bytes memory creditorSig = _signDigest(creditorKey, obligationDigest);

        vm.expectRevert(abi.encodeWithSelector(IContraflowRegistry.InvalidSignature.selector, debtor));
        registry.register(inv, debtorSig, creditorSig);
    }

    function test_register_stillAcceptsGenuineInvoiceSignatures() public {
        // Control: the same invoice registers when signed for the Registry's own domain, so the
        // rejection above is about the signature's domain, not a malformed invoice.
        (InvoiceAttestation memory inv,) = _matchingPair();
        bytes32 invoiceDigest = _digest(inv, address(registry));
        registry.register(inv, _sign(debtorKey, invoiceDigest), _sign(creditorKey, invoiceDigest));
    }

    function test_applyCertificate_rejectsModeAInvoiceSignatures() public {
        (InvoiceAttestation memory inv,) = _matchingPair();
        bytes32 invoiceDigest = _digest(inv, address(registry));

        NettingCertificate memory cert;
        cert.certificateId = keccak256("cross");
        cert.contentHash = keccak256("cross content");
        cert.deadline = uint64(block.timestamp + 1 days);
        cert.entries = new CertificateEntry[](2);
        cert.entries[0] = CertificateEntry({
            obligationId: invoiceDigest,
            debtor: debtor,
            creditor: creditor,
            priorCommitment: bytes32(0),
            nextCommitment: keccak256("next-0")
        });
        cert.entries[1] = CertificateEntry({
            obligationId: invoiceDigest,
            debtor: creditor,
            creditor: debtor,
            priorCommitment: bytes32(0),
            nextCommitment: keccak256("next-1")
        });

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(debtorKey, invoiceDigest);
        sigs[1] = _sign(creditorKey, invoiceDigest);

        vm.expectRevert(abi.encodeWithSelector(IContraflowNettingLedger.InvalidSignature.selector, debtor));
        ledger.applyCertificate(cert, sigs);
    }

    function test_domains_differ() public view {
        assertTrue(_ledgerDomainSeparator(address(ledger)) != _domainSeparator(address(registry)));
    }
}
