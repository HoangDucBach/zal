// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ZalVault} from "../src/ZalVault.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

contract ZalVaultTest is ZalTestBase {
    function _deposit(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        vault.deposit(amount, who);
        vm.stopPrank();
    }

    function _simulate(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        usdc.approve(address(vault), amount);
        vault.simulateYield(amount);
        vm.stopPrank();
    }

    function test_simulateYieldRaisesSharePrice() public {
        _deposit(lp, 1_000e6);
        _simulate(keeper, 50e6);
        assertEq(vault.totalAssets(), 1_050e6);
        assertApproxEqAbs(vault.maxWithdraw(lp), 1_050e6, 1);
        assertLe(vault.maxWithdraw(lp), 1_050e6);

        _simulate(owner, 50e6);
        assertEq(vault.totalAssets(), 1_100e6);
    }

    function test_simulateYieldOnlyOwnerOrKeeper() public {
        usdc.mint(stranger, 50e6);
        vm.startPrank(stranger);
        usdc.approve(address(vault), 50e6);
        vm.expectRevert(ZalVault.NotOwnerOrKeeper.selector);
        vault.simulateYield(50e6);
        vm.stopPrank();

        vm.expectRevert(ZalVault.ZeroAmount.selector);
        vm.prank(keeper);
        vault.simulateYield(0);
    }

    function test_setKeeperOnlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        vault.setKeeper(stranger);
        vm.prank(owner);
        vault.setKeeper(stranger);
        assertEq(vault.keeper(), stranger);
    }

    function test_sharesUseSixDecimalOffset() public view {
        assertEq(vault.decimals(), 12);
        assertEq(vault.symbol(), "zSV");
    }

    function testFuzz_depositThenRedeemNeverProfits(uint256 amount, uint256 yield) public {
        amount = bound(amount, 1, 1e15);
        yield = bound(yield, 1, 1e15);
        _deposit(lp, 1_000e6);
        _simulate(keeper, yield);
        _deposit(stranger, amount);
        uint256 shares = vault.balanceOf(stranger);
        vm.prank(stranger);
        uint256 out = vault.redeem(shares, stranger, stranger);
        assertLe(out, amount);
    }
}
