// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {Script, console2} from "forge-std/Script.sol";

// Contracts
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ContraflowNettingLedger} from "../src/ContraflowNettingLedger.sol";

/// @title DeployNettingLedger
/// @notice Deploys `ContraflowNettingLedger` (implementation + `ERC1967Proxy`) to Arc testnet.
/// The proxy is constructed and initialized in one transaction, so there is no window in which
/// someone else could call `initialize` first. The ledger has no dependency on the Registry or
/// Settler, so it deploys independently of them.
/// @dev Refuses to run against any chain ID other than Arc testnet.
contract DeployNettingLedger is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroOwner();
    error OwnerNotSet(address expected, address actual);

    function run() external returns (ContraflowNettingLedger ledger) {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address owner = vm.envAddress("OWNER_ADDRESS");
        if (owner == address(0)) revert ZeroOwner();

        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", vm.addr(deployerPk));
        console2.log("Owner:   ", owner);

        vm.startBroadcast(deployerPk);
        ContraflowNettingLedger impl = new ContraflowNettingLedger();
        ledger = ContraflowNettingLedger(
            address(new ERC1967Proxy(address(impl), abi.encodeCall(ContraflowNettingLedger.initialize, (owner))))
        );
        vm.stopBroadcast();

        if (ledger.owner() != owner) revert OwnerNotSet(owner, ledger.owner());

        console2.log("ContraflowNettingLedger implementation:", address(impl));
        console2.log("ContraflowNettingLedger proxy:         ", address(ledger));

        string memory obj = "nettingLedger";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "nettingLedgerImplementation", address(impl));
        string memory json = vm.serializeAddress(obj, "nettingLedgerProxy", address(ledger));
        vm.createDir("deployments", true);
        vm.writeJson(json, "deployments/testnet-netting-ledger.json");
    }
}
