// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @dev Passes the factory's asset check, then fails every deposit while `broken` is set.
contract FlakyVault {
    address public immutable asset;
    bool public broken = true;
    mapping(address holder => uint256) public balanceOf;

    constructor(address asset_) {
        asset = asset_;
    }

    function setBroken(bool broken_) external {
        broken = broken_;
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        require(!broken, "vault down");
        require(IERC20(asset).transferFrom(msg.sender, address(this), assets), "pull failed");
        balanceOf[receiver] += assets;
        return assets;
    }
}

/// @dev Passes the factory's asset check. `deposit` succeeds without pulling funds and returns no data.
contract NoReturnVault {
    address public immutable asset;

    constructor(address asset_) {
        asset = asset_;
    }

    function deposit(uint256, address) external {}
}

/// @dev Passes the factory's asset check. `deposit` succeeds and returns 31 bytes, one short of a word.
contract ShortReturnVault {
    address public immutable asset;

    constructor(address asset_) {
        asset = asset_;
    }

    function deposit(uint256, address) external pure {
        assembly ("memory-safe") {
            return(0, 31)
        }
    }
}

/// @dev Passes the factory's asset check. `deposit` burns all the gas it is given.
contract GasBurnVault {
    address public immutable asset;

    constructor(address asset_) {
        asset = asset_;
    }

    function deposit(uint256, address) external pure returns (uint256) {
        while (true) {}
        return 0;
    }
}

/// @dev A working vault that, inside `deposit`, sends every call in `attacks` to its target and counts the
/// ones that succeed. The depositing account is mid-route at that moment.
contract ReentrantVault {
    struct Attack {
        address target;
        bytes data;
    }

    address public immutable asset;
    mapping(address holder => uint256) public balanceOf;
    Attack[] private attacks;
    uint256 public attempts;
    uint256 public successes;

    constructor(address asset_) {
        asset = asset_;
    }

    function addAttack(address target, bytes calldata data) external {
        attacks.push(Attack(target, data));
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        for (uint256 i; i < attacks.length; ++i) {
            ++attempts;
            (bool ok,) = attacks[i].target.call(attacks[i].data);
            if (ok) ++successes;
        }
        require(IERC20(asset).transferFrom(msg.sender, address(this), assets), "pull failed");
        balanceOf[receiver] += assets;
        return assets;
    }
}
