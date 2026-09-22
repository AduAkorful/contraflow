// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {ContraflowRegistry} from "../../src/ContraflowRegistry.sol";
import {ContraflowSettler} from "../../src/ContraflowSettler.sol";

/// @notice Deploys a wired ContraflowRegistry + ContraflowSettler pair behind UUPS proxies,
/// resolving the circular address dependency (Registry needs Settler's address and vice versa)
/// the same way plans/00-architecture.md §10 describes for the real deploy script: predict the
/// Settler proxy's address before it exists (here via Foundry's nonce-prediction cheatcode
/// rather than CREATE2), initialize the Registry with that predicted address, then deploy and
/// initialize the Settler with the now-known Registry address. This setUp is itself a live
/// check that the two-step wiring approach actually works, not just an assertion in a doc.
abstract contract ContraflowDeployHelpers is Test {
    function _deployContraflow(address usdc_, address owner_)
        internal
        returns (ContraflowRegistry registry, ContraflowSettler settler)
    {
        ContraflowRegistry registryImpl = new ContraflowRegistry();
        ContraflowSettler settlerImpl = new ContraflowSettler();

        // The registry proxy will be deployed at the current nonce; the settler proxy right
        // after it, at current nonce + 1. Predict that address now so the registry can be
        // initialized with it immediately.
        address predictedSettlerProxy = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);

        registry = ContraflowRegistry(
            address(
                new ERC1967Proxy(
                    address(registryImpl), abi.encodeCall(ContraflowRegistry.initialize, (usdc_, predictedSettlerProxy, owner_))
                )
            )
        );

        settler = ContraflowSettler(
            address(
                new ERC1967Proxy(address(settlerImpl), abi.encodeCall(ContraflowSettler.initialize, (address(registry), owner_)))
            )
        );

        // If this ever fails, the nonce-prediction assumption above broke (e.g. an extra
        // CREATE happened in between) — fail loudly rather than silently testing against a
        // mis-wired pair.
        assertEq(address(settler), predictedSettlerProxy, "settler proxy address prediction drifted");
    }
}
