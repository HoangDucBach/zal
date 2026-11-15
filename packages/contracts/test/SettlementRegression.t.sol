// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {ZalTestBase} from "./support/ZalTestBase.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {ZalFundingPool} from "../src/ZalFundingPool.sol";
import {ReentrantVault} from "./support/Mocks.sol";
import {Leg, LegKind} from "../src/lib/ZalTypes.sol";

contract SettlementRegressionTest is ZalTestBase {
    // Credit advance, buyer escrows afterwards, stranger settles after due date: credit line is released.
    function test_creditAdvanceThenEscrowThenStrangerSettles() public {
        _lpDeposit(10_000e6);
        _enrol(address(C), 6_000e6);
        uint256 id = _approvedInvoice();
        _advance(id);
        assertEq(pool.obligorOutstanding(address(C)), 4_000e6);
        _clubEscrow(id);
        vm.warp(block.timestamp + TERM);
        uint256 before = usdc.balanceOf(address(pool));
        vm.prank(stranger);
        invoices.payInvoice(id);
        assertEq(pool.obligorOutstanding(address(C)), 0);
        assertEq(pool.outstanding(), 0);
        assertGt(usdc.balanceOf(address(pool)), before + 4_000e6);
        // new advance fits again
        uint256 id2 = _issue(1, FACE);
        _clubApprove(id2, 0);
        _advance(id2);
        assertEq(pool.obligorOutstanding(address(C)), 4_000e6);
    }

    // A reentrant vault leg on D's route tries to settle another escrowed invoice and to re-advance mid-route.
    function test_reentrantVaultCannotNestSettlement() public {
        ReentrantVault rv = new ReentrantVault(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(rv), true);
        Leg[] memory legs = new Leg[](2);
        legs[0] = Leg({kind: LegKind.Vault, target: address(rv), bps: 5_000});
        legs[1] = Leg({kind: LegKind.Hold, target: address(0), bps: 5_000});
        _setRoute(legs);
        uint256 id1 = _escrowedInvoice();
        uint256 id2 = _issue(1, FACE);
        _clubApprove(id2, 0);
        usdc.mint(address(C), FACE);
        _clubEscrow(id2);
        rv.addAttack(address(invoices), abi.encodeCall(invoices.payInvoice, (id2)));
        vm.warp(block.timestamp + TERM);
        vm.prank(stranger);
        invoices.payInvoice(id1);
        assertEq(rv.successes(), 0);
        assertEq(usdc.balanceOf(address(D)) + rv.balanceOf(address(D)), FACE);
        assertEq(usdc.balanceOf(address(invoices)), FACE);
    }
}
