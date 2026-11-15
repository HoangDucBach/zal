// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Testnet dollars with an open faucet. Anyone can mint, so this token has no value and must never be
/// deployed where it could be mistaken for USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC (testnet)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
