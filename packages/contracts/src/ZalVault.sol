// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

/// @dev Simulated yield for idle cash (ZR-VLT-01). There is no strategy and no oracle. The share price rises only
/// when the owner or the keeper pays USDC in through `simulateYield`. Every UI must label it simulated.
contract ZalVault is ERC4626, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    address public keeper;

    event KeeperSet(address indexed keeper);
    event YieldSimulated(address indexed from, uint256 amount);

    error NotOwnerOrKeeper();
    error ZeroAmount();

    /// @dev `keeper_` may be the zero address, which leaves only the owner able to simulate yield.
    // forge-lint: disable-next-line(missing-zero-check)
    constructor(IERC20 usdc, address owner_, address keeper_)
        ERC4626(usdc)
        ERC20("Zal Simulated Vault", "zSV")
        Ownable(owner_)
    {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    // forge-lint: disable-next-line(missing-zero-check)
    function setKeeper(address keeper_) external onlyOwner {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @dev Pulls `amount` from the caller. Shares are not minted, so every share is worth more afterwards.
    function simulateYield(uint256 amount) external nonReentrant {
        if (msg.sender != owner() && msg.sender != keeper) revert NotOwnerOrKeeper();
        if (amount == 0) revert ZeroAmount();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        emit YieldSimulated(msg.sender, amount);
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @dev ZR-FND-06.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
