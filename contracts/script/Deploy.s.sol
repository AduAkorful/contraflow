// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

// Libraries
import {Script, console2} from "forge-std/Script.sol";

// Contracts
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ContraflowRegistry} from "../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../src/ContraflowSettler.sol";

/// @title Deploy
/// @notice Deploy script for Arc testnet (`5042002`). Deploys implementation + `ERC1967Proxy`
/// pairs for `ContraflowRegistry` and `ContraflowSettler`, wiring them atomically via
/// nonce-prediction, matching the pattern proven in
/// `contracts/test/helpers/ContraflowDeployHelpers.sol`. Each proxy is constructed *and*
/// initialized in the same transaction, which closes the initializer-front-running window a
/// bare `deploy-then-initialize` sequence would leave open.
/// @dev Refuses to run against any chain ID other than Arc testnet — mainnet uses a separate
/// deploy script.
contract Deploy is Script {
    /// @notice Arc's canonical ERC-20 USDC interface. Identical address on mainnet and testnet.
    /// @dev Hardcoded, not read from an env var — this is a verified protocol constant, not
    /// per-environment config, so a typo in an env var can never silently wire a fake token.
    /// Verified on-chain via `cast code` / `cast call symbol()/decimals()` before use.
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
        // implementations above already consumed one each), the Settler proxy right after it —
        // predict that address now so the Registry can be initialized with it in the same
        // transaction it is created. Must be captured here, after the implementation deploys,
        // exactly matching contracts/test/helpers/ContraflowDeployHelpers.sol — capturing it
        // any earlier (e.g. before the implementation deploys) predicts the wrong slot.
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

    /// @dev Writes a curated, chain-id-keyed summary to `deployments/testnet.json`, the shape
    /// the app's own contract-address config consumes. This is distinct from Foundry's own
    /// `broadcast/` transaction log (raw, gitignored); this file is public addresses only, no
    /// secrets.
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
        // missing directories itself, which breaks a fresh checkout's first run. Create it
        // defensively rather than depending on it already existing.
        vm.createDir("deployments", true);
        vm.writeJson(finalJson, "deployments/testnet.json");
    }
}
