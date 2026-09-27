// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script, console2} from "forge-std/Script.sol";

import {ContraflowNettingLedger} from "../src/ContraflowNettingLedger.sol";
import {CertificateEntry, NettingCertificate} from "../src/interfaces/IContraflowNettingLedger.sol";

/// @title SmokeTestNettingLedger
/// @notice Applies one real two-party certificate to the deployed testnet ledger. The two parties
/// are throwaway keys passed in for this run only (`PARTY_A_PK`, `PARTY_B_PK`); they only sign,
/// and the deployer submits, since `applyCertificate` is permissionless.
contract SmokeTestNettingLedger is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    error WrongChain(uint256 actual, uint256 expected);
    error StateNotAdvanced(bytes32 key);

    function run() external {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);

        ContraflowNettingLedger ledger = ContraflowNettingLedger(vm.envAddress("NETTING_LEDGER"));
        uint256 aPk = vm.envUint("PARTY_A_PK");
        uint256 bPk = vm.envUint("PARTY_B_PK");
        address a = vm.addr(aPk);
        address b = vm.addr(bPk);
        bytes32 runSalt = keccak256(abi.encode(a, b, block.timestamp));

        NettingCertificate memory cert;
        cert.certificateId = keccak256(abi.encode("smoke-certificate", runSalt));
        cert.contentHash = keccak256(abi.encode("smoke-certificate-document", runSalt));
        cert.deadline = uint64(block.timestamp + 1 hours);
        cert.entries = new CertificateEntry[](2);
        cert.entries[0] = CertificateEntry({
            obligationId: keccak256(abi.encode("smoke-obligation-a-owes-b", runSalt)),
            debtor: a,
            creditor: b,
            priorCommitment: bytes32(0),
            nextCommitment: keccak256(abi.encode("smoke-next-0", runSalt))
        });
        cert.entries[1] = CertificateEntry({
            obligationId: keccak256(abi.encode("smoke-obligation-b-owes-a", runSalt)),
            debtor: b,
            creditor: a,
            priorCommitment: bytes32(0),
            nextCommitment: keccak256(abi.encode("smoke-next-1", runSalt))
        });

        bytes32 digest = ledger.certificateDigest(cert);
        bytes[] memory sigs = new bytes[](2);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aPk, digest);
        sigs[0] = abi.encodePacked(r, s, v);
        (v, r, s) = vm.sign(bPk, digest);
        sigs[1] = abi.encodePacked(r, s, v);

        vm.startBroadcast(vm.envUint("DEPLOYER_PK"));
        ledger.applyCertificate(cert, sigs);
        vm.stopBroadcast();

        for (uint256 i = 0; i < 2; ++i) {
            bytes32 key = ledger.obligationKey(cert.entries[i].obligationId, cert.entries[i].debtor, cert.entries[i].creditor);
            if (ledger.stateOf(key) != cert.entries[i].nextCommitment) revert StateNotAdvanced(key);
            console2.log("obligation key:");
            console2.logBytes32(key);
            console2.log("expected commitment:");
            console2.logBytes32(cert.entries[i].nextCommitment);
        }
        console2.log("certificate id:");
        console2.logBytes32(cert.certificateId);
        console2.log("party A:", a);
        console2.log("party B:", b);
    }
}
