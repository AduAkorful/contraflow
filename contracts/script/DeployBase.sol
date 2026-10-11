// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

// Libraries
import {Script, VmSafe} from "forge-std/Script.sol";

/// @title DeployBase
/// @notice What every deploy and smoke script shares: the two chains they may run on, the record
/// file they write, and the guards around it.
/// @dev The chain guard is strict: exactly Arc testnet (`5042002`) or Arc mainnet (`5042`). A
/// record is written only while broadcasting, so a dry run (`forge script` without `--broadcast`)
/// never leaves simulated addresses on disk, and an existing record is never replaced unless
/// `DEPLOY_OVERWRITE` says so. `DEPLOY_OUT_DIR` redirects records to another allowed directory
/// (`rehearsal/` is git-ignored), so a rehearsal can't touch `deployments/`.
abstract contract DeployBase is Script {
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;

    string internal constant DEFAULT_OUT_DIR = "deployments";

    error UnsupportedChain(uint256 actual);
    error MainnetNotConfirmed();
    error RecordExists(string path);

    /// @notice "testnet" or "mainnet" for the chain being run against; reverts on any other chain.
    function _network() internal view returns (string memory) {
        if (block.chainid == ARC_TESTNET_CHAIN_ID) return "testnet";
        if (block.chainid == ARC_MAINNET_CHAIN_ID) return "mainnet";
        revert UnsupportedChain(block.chainid);
    }

    /// @notice Where this script's record goes: `<out dir>/<network><suffix>.json`.
    function _recordPath(string memory suffix) internal view returns (string memory) {
        return string.concat(vm.envOr("DEPLOY_OUT_DIR", DEFAULT_OUT_DIR), "/", _network(), suffix, ".json");
    }

    function _isBroadcasting() internal view virtual returns (bool) {
        return vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume);
    }

    /// @notice Mainnet transactions spend real funds, so broadcasting there needs an explicit,
    /// per-run confirmation in the environment. Simulating needs none.
    function _requireMainnetConfirmation() internal view {
        if (block.chainid != ARC_MAINNET_CHAIN_ID || !_isBroadcasting()) return;
        if (!vm.envOr("CONFIRM_MAINNET", false)) revert MainnetNotConfirmed();
    }

    /// @notice Writes `json` to `path` while broadcasting; does nothing in a dry run.
    function _writeRecord(string memory path, string memory json) internal {
        if (!_isBroadcasting()) return;
        if (vm.exists(path) && !vm.envOr("DEPLOY_OVERWRITE", false)) revert RecordExists(path);
        // vm.writeJson doesn't create missing directories, which breaks a fresh checkout's first run.
        vm.createDir(vm.envOr("DEPLOY_OUT_DIR", DEFAULT_OUT_DIR), true);
        vm.writeJson(json, path);
    }
}
