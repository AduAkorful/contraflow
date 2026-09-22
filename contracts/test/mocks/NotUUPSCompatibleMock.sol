// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// @notice A contract that is intentionally NOT UUPS-proxiable (no `proxiableUUID`), used by
/// both ContraflowRegistry and ContraflowSettler upgrade tests to prove `upgradeToAndCall`
/// rejects a non-compliant target rather than silently bricking the proxy.
contract NotUUPSCompatibleMock {
    function ping() external pure returns (uint256) {
        return 1;
    }
}
