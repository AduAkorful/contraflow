// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/// @notice Smart-account stand-in with a configurable answer to `isValidSignature`, so tests can
/// drive every response shape a real (or hostile) wallet might give.
contract MockERC1271Wallet is IERC1271 {
    enum Mode {
        ApproveDigest,
        AlwaysReject,
        Revert,
        GarbageMagic,
        ShortReturn
    }

    Mode public mode;
    bytes32 public approvedDigest;

    function setMode(Mode mode_) external {
        mode = mode_;
    }

    function approve(bytes32 digest) external {
        approvedDigest = digest;
    }

    function isValidSignature(bytes32 hash, bytes memory) external view returns (bytes4) {
        if (mode == Mode.Revert) revert("wallet says no");
        if (mode == Mode.AlwaysReject) return 0xffffffff;
        if (mode == Mode.GarbageMagic) return 0xdeadbeef;
        if (mode == Mode.ShortReturn) {
            assembly {
                mstore(0, 0x1626ba7e00000000000000000000000000000000000000000000000000000000)
                return(0, 2)
            }
        }
        return hash == approvedDigest ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}

/// @notice An EIP-7702 delegate with no ERC-1271 support at all — the case where OZ's default
/// signature order would wrongly reject a delegated EOA's genuine ECDSA signature.
contract PlainDelegate {
    function ping() external pure returns (uint256) {
        return 1;
    }
}

/// @notice An EIP-7702 delegate that answers ERC-1271 by checking ECDSA against the account itself.
contract ERC1271Delegate is IERC1271 {
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        return ecrecover(hash, v, r, s) == address(this) ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}
