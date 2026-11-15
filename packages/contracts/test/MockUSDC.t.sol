// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ZalTestBase} from "./support/ZalTestBase.sol";

contract MockUSDCTest is ZalTestBase {
    function test_sixDecimalsAndTestnetLabel() public view {
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.symbol(), "USDC");
        assertEq(usdc.name(), "Mock USDC (testnet)");
    }

    function test_anyoneCanMint() public {
        vm.prank(stranger);
        usdc.mint(stranger, 1_000e6);
        assertEq(usdc.balanceOf(stranger), 1_000e6);
        assertEq(usdc.totalSupply(), 1_000e6);
    }
}
