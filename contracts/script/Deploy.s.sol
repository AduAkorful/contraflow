// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// Libraries
import {Script, console2} from "forge-std/Script.sol";

// Contracts
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ContraflowRegistry} from "../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../src/ContraflowSettler.sol";

/// @title Deploy
/// @notice Testnet-rehearsal deploy script for Arc testnet (`5042002`), per
/// `plans/02-deploy-testnet.md`. Deploys implementation + `ERC1967Proxy` pairs for
/// `ContraflowRegistry` and `ContraflowSettler`, wiring them atomically via nonce-prediction —
/// the same pattern `contracts/test/helpers/ContraflowDeployHelpers.sol` already proves across
/// 97 passing tests. Each proxy is constructed *and* initialized in the same transaction, which
/// closes the initializer-front-running window a bare `deploy-then-initialize` sequence would
/// leave open (see the 2026-09-18 adversarial audit note in `AGENTS.md`).
/// @dev Refuses to run against any chain ID other than Arc testnet — mainnet (`5042`) is a
/// separate, not-yet-written step plan with its own operator go-ahead, per `AGENTS.md`.
contract Deploy is Script {
    /// @notice Arc's canonical ERC-20 USDC interface. Identical address on mainnet and testnet.
    /// @dev Hardcoded, not read from an env var — this is a verified protocol constant, not
    /// per-environment config (per `contract-addresses.md`: don't let an env var typo silently
    /// wire a fake token). Verified live on both networks on 2026-09-18 via `cast code` /
    /// `cast call symbol()/decimals()` — see `plans/02-deploy-testnet.md`'s research table.
    address internal constant USDC = 0x3600000000000000000000000000000000000000;

    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    error WrongChain(uint256 actual, uint256 expected);
    error ZeroOwner();
    error SettlerAddressPredictionDrifted(address predicted, address actual);

    function run() external returns (ContraflowRegistry registry, ContraflowSettler settler) {
        if (block.chainid != ARC_TESTNET_CHAIN_ID) revert WrongChain(block.chainid, ARC_TESTNET_CHAIN_ID);

        uint256 deployerPk = vm.envUint("DEPLOYER_PK");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address deployer = vm.addr(deployerPk);

        if (owner == address(0)) revert ZeroOwner();

        console2.log("Chain ID:      ", block.chainid);
        console2.log("Deployer:      ", deployer);
        console2.log("Owner:         ", owner);
        console2.log("USDC:          ", USDC);

        vm.startBroadcast(deployerPk);

        ContraflowRegistry registryImpl = new ContraflowRegistry();
        ContraflowSettler settlerImpl = new ContraflowSettler();

        // The Registry proxy lands at the deployer's *current* nonce (after both
        // implementations above already consumed two), the Settler proxy right after it —
        // predict that address now so the Registry can be initialized with it in the same
        // transaction it is created, per plans/02-deploy-testnet.md decision 1. Must be captured
        // here, after the implementation deploys, exactly matching
        // contracts/test/helpers/ContraflowDeployHelpers.sol — capturing it any earlier (e.g.
        // before the implementation deploys) predicts the wrong slot, as this script's own
        // testnet dry run caught on 2026-09-18 (see plans/02-deploy-testnet.md's research notes).
        address predictedSettlerProxy = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);

        registry = ContraflowRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl),
                    abi.encodeCall(ContraflowRegistry.initialize, (USDC, predictedSettlerProxy, owner))
                )
            )
        );

        settler = ContraflowSettler(
            address(
                new ERC1967Proxy(
                    address(settlerImpl), abi.encodeCall(ContraflowSettler.initialize, (address(registry), owner))
                )
            )
        );

        vm.stopBroadcast();

        // Fail loudly rather than hand back a mis-wired pair if an unexpected extra CREATE
        // landed between the prediction and the Settler proxy deploy.
        if (address(settler) != predictedSettlerProxy) {
            revert SettlerAddressPredictionDrifted(predictedSettlerProxy, address(settler));
        }

        console2.log("ContraflowRegistry implementation:", address(registryImpl));
        console2.log("ContraflowRegistry proxy:         ", address(registry));
        console2.log("ContraflowSettler implementation: ", address(settlerImpl));
        console2.log("ContraflowSettler proxy:          ", address(settler));

        _writeDeploymentRecord(address(registryImpl), address(registry), address(settlerImpl), address(settler), owner);
    }

    /// @dev Writes a curated, chain-id-keyed summary to `deployments/testnet.json` — the shape
    /// `plans/00-architecture.md` §8 says `app/lib/contracts/` will eventually consume. This is
    /// distinct from Foundry's own `broadcast/` transaction log (raw, gitignored); this file is
    /// public addresses only, no secrets.
    function _writeDeploymentRecord(
        address registryImpl,
        address registryProxy,
        address settlerImpl,
        address settlerProxy,
        address owner
    ) internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "usdc", USDC);
        vm.serializeAddress(obj, "owner", owner);
        vm.serializeAddress(obj, "registryImplementation", registryImpl);
        vm.serializeAddress(obj, "registryProxy", registryProxy);
        vm.serializeAddress(obj, "settlerImplementation", settlerImpl);
        string memory finalJson = vm.serializeAddress(obj, "settlerProxy", settlerProxy);

        // deployments/ is not git-tracked (empty dirs aren't) and vm.writeJson does not create
        // missing directories itself — this script's own dry run hit that on a fresh checkout
        // (2026-09-18). Create it defensively rather than depending on it already existing.
        vm.createDir("deployments", true);
        vm.writeJson(finalJson, "deployments/testnet.json");
    }
}
