// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// Libraries
import {Script, console2} from "forge-std/Script.sol";

// Contracts
import {ContraflowRegistry} from "../src/ContraflowRegistry.sol";

// Interfaces
import {InvoiceAttestation, Invoice} from "../src/interfaces/IContraflowRegistry.sol";

/// @title SmokeTestRegister
/// @notice One-off functional smoke test for a freshly-deployed `ContraflowRegistry` on Arc
/// testnet, per `plans/02-deploy-testnet.md` step 5. Registers one throwaway 2-party invoice
/// signed by two disposable keys (never funded, used for nothing else) and reads it back,
/// proving EIP-712 domain binding and nonce handling work against real Arc testnet state, not
/// just Foundry's local EVM. Not part of the fixture/app flow — this is deploy-verification
/// scaffolding, safe to ignore once the app's own attest flow exists.
/// @dev Deliberately reimplements the EIP-712 digest independently of
/// `ContraflowRegistry._hashInvoice`/`_hashTypedDataV4`, same rationale as
/// `contracts/test/helpers/InvoiceSigningHelpers.sol`: a bug in the contract's own hashing must
/// not be masked by reusing the same logic to build the signature under test.
contract SmokeTestRegister is Script {
    bytes32 internal constant INVOICE_TYPEHASH = keccak256(
        "InvoiceAttestation(bytes32 invoiceRef,uint256 amount,address currency,uint64 maturity,bool earlyNetConsent,address debtor,address creditor,uint256 nonce,address registry,uint256 chainId)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    function run() external {
        address registryAddr = vm.envAddress("REGISTRY_PROXY");
        uint256 deployerPk = vm.envUint("DEPLOYER_PK");

        ContraflowRegistry registry = ContraflowRegistry(registryAddr);
        address usdc = registry.usdc();

        // Disposable keys, funded with nothing — they never send a transaction themselves, only
        // sign the attestation. The deployer submits register() and pays the gas.
        uint256 debtorPk = uint256(keccak256("contraflow-smoke-debtor"));
        uint256 creditorPk = uint256(keccak256("contraflow-smoke-creditor"));
        address debtor = vm.addr(debtorPk);
        address creditor = vm.addr(creditorPk);

        InvoiceAttestation memory invoice = InvoiceAttestation({
            invoiceRef: keccak256("contraflow-testnet-smoke-1"),
            amount: 1_000_000, // 1.00 USDC, 6 decimals
            currency: usdc,
            maturity: uint64(block.timestamp + 30 days),
            earlyNetConsent: true,
            debtor: debtor,
            creditor: creditor,
            nonce: 1,
            registry: registryAddr,
            chainId: block.chainid
        });

        bytes32 digest = _digest(invoice, registryAddr);
        bytes memory debtorSig = _sign(debtorPk, digest);
        bytes memory creditorSig = _sign(creditorPk, digest);

        vm.startBroadcast(deployerPk);
        bytes32 id = registry.register(invoice, debtorSig, creditorSig);
        vm.stopBroadcast();

        console2.log("Registered invoice id:");
        console2.logBytes32(id);

        Invoice memory stored = registry.getInvoice(id);

        console2.log("Read-back debtor:   ", stored.debtor);
        console2.log("Read-back creditor: ", stored.creditor);
        console2.log("Read-back remaining:", stored.amountRemaining);
        console2.log("Read-back nonce:    ", stored.nonce);

        require(stored.debtor == debtor, "smoke test: debtor mismatch");
        require(stored.creditor == creditor, "smoke test: creditor mismatch");
        require(stored.amountRemaining == 1_000_000, "smoke test: amountRemaining mismatch");
        require(stored.nonce == 1, "smoke test: nonce mismatch");

        console2.log("SMOKE TEST PASSED: register() + getInvoice() round-trip correctly on real Arc testnet state.");
    }

    function _domainSeparator(address registryAddr) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256(bytes("ContraflowRegistry")), keccak256(bytes("1")), block.chainid, registryAddr
            )
        );
    }

    function _digest(InvoiceAttestation memory inv, address registryAddr) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INVOICE_TYPEHASH,
                inv.invoiceRef,
                inv.amount,
                inv.currency,
                inv.maturity,
                inv.earlyNetConsent,
                inv.debtor,
                inv.creditor,
                inv.nonce,
                inv.registry,
                inv.chainId
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(registryAddr), structHash));
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
