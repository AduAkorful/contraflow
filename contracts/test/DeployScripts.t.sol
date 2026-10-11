// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test} from "forge-std/Test.sol";

import {ContraflowRegistry} from "../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../src/ContraflowSettler.sol";
import {ContraflowNettingLedger} from "../src/ContraflowNettingLedger.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {DeployNettingLedger} from "../script/DeployNettingLedger.s.sol";
import {DeployBase} from "../script/DeployBase.sol";

/// @dev A deploy script that behaves as if it were being broadcast, so the record-writing path
/// can be exercised without a live chain.
contract BroadcastingDeploy is Deploy {
    function _isBroadcasting() internal pure override returns (bool) {
        return true;
    }
}

contract BroadcastingLedgerDeploy is DeployNettingLedger {
    function _isBroadcasting() internal pure override returns (bool) {
        return true;
    }
}

contract DeployScriptsTest is Test {
    uint256 internal constant TESTNET = 5042002;
    uint256 internal constant MAINNET = 5042;
    string internal constant OUT_DIR = "rehearsal/unit-test";

    uint256 internal deployerPk = uint256(keccak256("contraflow-deploy-script-test"));
    address internal owner = makeAddr("owner");

    /// @dev One test on purpose: the scripts read the process-wide environment, which Foundry's
    /// parallel test runner would otherwise let one test overwrite under another.
    function test_deployScripts() public {
        _refusesAnyChainOtherThanArc();
        _deploysAndWiresOnTestnetAndMainnet();
        _zeroOwnerReverts();
        _recordsOnlyWhenBroadcastingAndNeverOverwritesByDefault();
    }

    function _env() internal {
        vm.setEnv("DEPLOYER_PK", vm.toString(deployerPk));
        vm.setEnv("OWNER_ADDRESS", vm.toString(owner));
    }

    function _clean() internal {
        if (vm.exists(OUT_DIR)) vm.removeDir(OUT_DIR, true);
    }

    function _refusesAnyChainOtherThanArc() internal {
        _env();
        vm.chainId(1);
        Deploy deploy = new Deploy();
        vm.expectRevert(abi.encodeWithSelector(DeployBase.UnsupportedChain.selector, 1));
        deploy.run();

        DeployNettingLedger ledgerDeploy = new DeployNettingLedger();
        vm.expectRevert(abi.encodeWithSelector(DeployBase.UnsupportedChain.selector, 1));
        ledgerDeploy.run();
    }

    function _deploysAndWiresOnTestnetAndMainnet() internal {
        _env();
        uint256[2] memory chains = [TESTNET, MAINNET];
        for (uint256 i = 0; i < chains.length; ++i) {
            vm.chainId(chains[i]);
            (ContraflowRegistry registry, ContraflowSettler settler) = new Deploy().run();
            assertEq(registry.owner(), owner);
            assertEq(settler.owner(), owner);
            assertEq(registry.settler(), address(settler));
            assertEq(address(settler.registry()), address(registry));

            ContraflowNettingLedger ledger = new DeployNettingLedger().run();
            assertEq(ledger.owner(), owner);
        }
    }

    function _zeroOwnerReverts() internal {
        vm.setEnv("OWNER_ADDRESS", vm.toString(address(0)));
        vm.chainId(TESTNET);
        Deploy deploy = new Deploy();
        vm.expectRevert(Deploy.ZeroOwner.selector);
        deploy.run();
        vm.setEnv("OWNER_ADDRESS", vm.toString(owner));
    }

    function _recordsOnlyWhenBroadcastingAndNeverOverwritesByDefault() internal {
        _env();
        _clean();
        vm.setEnv("DEPLOY_OUT_DIR", OUT_DIR);
        vm.setEnv("DEPLOY_OVERWRITE", "false");
        vm.setEnv("CONFIRM_MAINNET", "false");

        // A dry run leaves nothing on disk.
        vm.chainId(TESTNET);
        new Deploy().run();
        assertFalse(vm.exists(string.concat(OUT_DIR, "/testnet.json")));

        // Broadcasting writes `<out dir>/<network>.json`, in the directory asked for.
        BroadcastingDeploy broadcasting = new BroadcastingDeploy();
        (ContraflowRegistry registry, ContraflowSettler settler) = broadcasting.run();
        string memory path = string.concat(OUT_DIR, "/testnet.json");
        assertTrue(vm.exists(path));
        string memory json = vm.readFile(path);
        assertEq(vm.parseJsonUint(json, ".chainId"), TESTNET);
        assertEq(vm.parseJsonAddress(json, ".registryProxy"), address(registry));
        assertEq(vm.parseJsonAddress(json, ".settlerProxy"), address(settler));
        assertEq(vm.parseJsonAddress(json, ".owner"), owner);

        // A second run won't replace it unless asked to.
        BroadcastingDeploy again = new BroadcastingDeploy();
        vm.expectRevert(abi.encodeWithSelector(DeployBase.RecordExists.selector, path));
        again.run();
        vm.setEnv("DEPLOY_OVERWRITE", "true");
        again.run();
        vm.setEnv("DEPLOY_OVERWRITE", "false");

        // The ledger's record sits beside it under its own name.
        ContraflowNettingLedger ledger = new BroadcastingLedgerDeploy().run();
        string memory ledgerJson = vm.readFile(string.concat(OUT_DIR, "/testnet-netting-ledger.json"));
        assertEq(vm.parseJsonAddress(ledgerJson, ".nettingLedgerProxy"), address(ledger));

        // Mainnet files are named for mainnet, and broadcasting there needs confirmation.
        vm.chainId(MAINNET);
        BroadcastingDeploy mainnet = new BroadcastingDeploy();
        vm.expectRevert(DeployBase.MainnetNotConfirmed.selector);
        mainnet.run();
        vm.setEnv("CONFIRM_MAINNET", "true");
        mainnet.run();
        assertTrue(vm.exists(string.concat(OUT_DIR, "/mainnet.json")));
        vm.setEnv("CONFIRM_MAINNET", "false");

        _clean();
    }
}
