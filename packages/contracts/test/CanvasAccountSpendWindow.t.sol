// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Vm} from "forge-std/Vm.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {ScheduleKind} from "../src/lib/ZalTypes.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

/// @dev ZR-ACC-11, ADR 0016. The club `C` is 2 of 3 above `LIMIT` per rolling 24 h.
contract CanvasAccountSpendWindowTest is ZalTestBase {
    uint128 internal constant LIMIT = 1_000e6;

    address internal payee = makeAddr("payee");

    event SpendWindowCharged(uint256 indexed opId, uint128 amount, uint128 windowSpent, uint64 windowStart);

    function setUp() public override {
        super.setUp();
        vm.prank(c1);
        C.setPolicy(2, LIMIT);
        usdc.mint(address(C), 100_000e6);
    }

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    function _withdraw(address by, uint256 amount) internal returns (uint256 opId) {
        vm.prank(by);
        opId = C.submit(abi.encodeCall(CanvasAccount.withdraw, (payee, amount)));
    }

    function _transferSchedule(uint128 amount, uint32 runs) internal pure returns (bytes memory) {
        uint32 interval = runs == 1 ? 0 : 60;
        return abi.encodeCall(
            CanvasAccount.createSchedule,
            (ScheduleKind.Transfer, address(0xBEEF), 0, amount, 1_800_000_000, interval, runs)
        );
    }

    function _executed(uint256 opId) internal view returns (bool) {
        return C.getOp(opId).executed;
    }

    function _spent() internal view returns (uint128 spent) {
        (, spent,) = C.spendWindow();
    }

    function test_AT26_secondSplitWaitsAndTheWindowRollsAfter24Hours() public {
        _withdraw(c1, 600e6);
        assertEq(usdc.balanceOf(payee), 600e6, "first 600 runs on c1 alone");

        uint256 second = _withdraw(c1, 600e6);
        assertEq(usdc.balanceOf(payee), 600e6, "second 600 would take the window to 1,200");
        vm.prank(c2);
        C.confirm(second);
        assertEq(usdc.balanceOf(payee), 1_200e6, "c2 brings it to the threshold");
        assertEq(_spent(), 600e6, "an op at the threshold spends nothing from the window");

        vm.warp(_now() + 1 days);
        _withdraw(c1, 600e6);
        assertEq(usdc.balanceOf(payee), 1_800e6, "after 24 h, 600 runs on c1 alone again");
    }

    function test_AT27_splitSchedulesNeedTheThresholdPastTheFirst() public {
        uint256[] memory ops = new uint256[](5);
        for (uint256 i; i < 5; ++i) {
            vm.prank(c1);
            ops[i] = C.submit(_transferSchedule(LIMIT, 1));
        }
        assertEq(C.scheduleCount(), 1, "only the first schedule exists");
        assertTrue(_executed(ops[0]));
        for (uint256 i = 1; i < 5; ++i) {
            assertFalse(_executed(ops[i]), "the rest wait");
        }
    }

    /// @dev The audit repro (15 Nov 2026): five 1,000 withdrawals on one signature paid 5,000.
    function test_splitWithdrawsNoLongerBypassApprovalLimit() public {
        for (uint256 i; i < 5; ++i) {
            _withdraw(c1, LIMIT);
        }
        assertEq(usdc.balanceOf(payee), LIMIT);
    }

    /// @dev The audit repro (15 Nov 2026): five 1,000 single-run schedules on one signature committed 5,000.
    function test_splitSchedulesNoLongerBypassApprovalLimit() public {
        for (uint256 i; i < 5; ++i) {
            vm.prank(c1);
            C.submit(_transferSchedule(LIMIT, 1));
        }
        uint256 committed;
        for (uint256 id = 1; id <= C.scheduleCount(); ++id) {
            committed += uint256(C.getSchedule(id).amount) * C.getSchedule(id).remaining;
        }
        assertEq(committed, LIMIT);
    }

    function test_recurringScheduleCountsEveryRun() public {
        vm.prank(c1);
        uint256 opId = C.submit(_transferSchedule(400e6, 3));
        assertFalse(_executed(opId), "3 x 400 is over the allowance");
        vm.prank(c1);
        C.submit(_transferSchedule(400e6, 2));
        assertEq(_spent(), 800e6);
    }

    function test_windowExpiresAtExactly24Hours() public {
        _withdraw(c1, LIMIT);
        uint64 start = _now();

        vm.warp(start + 1 days - 1);
        uint256 early = _withdraw(c1, 1);
        assertFalse(_executed(early), "one second before 24 h the window is still full");
        assertEq(C.requiredConfirmations(1), 2);

        vm.warp(start + 1 days);
        assertEq(C.requiredConfirmations(LIMIT), 1);
        (uint64 oldStart, uint128 spent, uint128 remaining) = C.spendWindow();
        assertEq(oldStart, start, "an expired window reports its old start");
        assertEq(spent, 0);
        assertEq(remaining, LIMIT);

        vm.expectEmit(address(C));
        emit SpendWindowCharged(early + 1, LIMIT, LIMIT, start + 1 days);
        _withdraw(c1, LIMIT);
        (uint64 newStart,,) = C.spendWindow();
        assertEq(newStart, start + 1 days, "the window restarts at the charge");
    }

    function test_waitingOpRunsOnItsFirstConfirmationOnceTheWindowRolls() public {
        _withdraw(c1, LIMIT);
        uint256 opId = _withdraw(c1, 500e6);
        vm.warp(_now() + 1 days);
        vm.prank(c1);
        C.revoke(opId);
        vm.prank(c1);
        C.confirm(opId);
        assertTrue(_executed(opId), "the window rolled, so one confirmation is enough");
        assertEq(_spent(), 500e6);
    }

    function test_opPricedAtOneConfirmationWaitsWhenTheWindowFillsFirst() public {
        vm.prank(c1);
        C.setPolicy(3, LIMIT);
        uint256 opId = _withdraw(c3, 2_000e6);
        vm.prank(c2);
        C.confirm(opId);
        assertFalse(_executed(opId), "two of three on an op above the allowance");

        _withdraw(c1, LIMIT);
        vm.warp(_now() + 1 days);
        assertEq(C.requiredConfirmations(400e6), 1, "a 400 op would run alone now");
        uint256 small = _withdraw(c1, 400e6);
        assertTrue(_executed(small));

        uint256 waiting = _withdraw(c2, 700e6);
        assertFalse(_executed(waiting), "submitted after the window filled to 400");
        vm.prank(c1);
        C.confirm(waiting);
        assertFalse(_executed(waiting), "two of three is still below the threshold");
        vm.prank(c3);
        C.confirm(waiting);
        assertTrue(_executed(waiting), "the full threshold runs even with the window spent");
        assertEq(_spent(), 400e6, "and spends nothing from it");
    }

    function test_executionBelowThresholdWithSeveralConfirmationsChargesTheWindow() public {
        vm.prank(c1);
        C.setPolicy(3, LIMIT);
        _withdraw(c1, LIMIT);
        uint256 opId = _withdraw(c1, 300e6);
        vm.warp(_now() + 1 days);
        vm.prank(c2);
        C.confirm(opId);
        assertTrue(_executed(opId), "two confirmations, one required");
        assertEq(_spent(), 300e6, "two of three is still single-signature spend");
    }

    function test_fullThresholdDoesNotChargeTheWindow() public {
        uint256 opId = _withdraw(c1, 5_000e6);
        vm.recordLogs();
        vm.prank(c2);
        C.confirm(opId);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            assertNotEq(logs[i].topics[0], SpendWindowCharged.selector, "no window charge at the threshold");
        }
        assertTrue(_executed(opId));
        assertEq(_spent(), 0);
    }

    function test_policyChangeKeepsTheWindow() public {
        _withdraw(c1, 800e6);
        vm.prank(c1);
        C.setPolicy(2, 500e6);
        (, uint128 spent, uint128 remaining) = C.spendWindow();
        assertEq(spent, 800e6);
        assertEq(remaining, 0, "remaining floors at 0 when the limit drops under the spend");
        assertEq(C.requiredConfirmations(1), 2);
    }

    function test_singleSignerAccountRecordsSpendButNeverBlocks() public {
        usdc.mint(address(D), 10_000e6);
        for (uint256 i; i < 3; ++i) {
            vm.prank(d);
            D.submit(abi.encodeCall(CanvasAccount.withdraw, (payee, 3_000e6)));
        }
        assertEq(usdc.balanceOf(payee), 9_000e6);
        (, uint128 spent, uint128 remaining) = D.spendWindow();
        assertEq(spent, 9_000e6);
        assertEq(remaining, 0);
    }

    function test_singleSignerWindowSaturates() public {
        uint128 max = type(uint128).max;
        vm.startPrank(d);
        vm.expectEmit(address(D));
        emit SpendWindowCharged(1, max, max, _now());
        D.submit(_transferSchedule(max, 2));
        vm.expectEmit(address(D));
        emit SpendWindowCharged(2, 1, max, _now());
        D.submit(_transferSchedule(1, 1));
        vm.stopPrank();
        (, uint128 spent,) = D.spendWindow();
        assertEq(spent, max);
    }

    /// @dev Random withdrawals by c1, each sometimes confirmed by c2, with random gaps. A model of ADR 0016
    /// predicts every outcome, and single-signature spend never exceeds the limit inside one window.
    function testFuzz_windowCapsSingleSignatureSpend(uint256[12] calldata amounts, uint256[12] calldata gaps) public {
        uint64 start;
        uint256 spent;
        uint256 cosigned;
        for (uint256 i; i < amounts.length; ++i) {
            vm.warp(_now() + bound(gaps[i], 0, 30 hours));
            uint256 amount = bound(amounts[i], 1, 1_500e6);
            if (_now() >= start + 1 days) spent = 0;
            bool alone = spent + amount <= LIMIT;

            uint256 opId = _withdraw(c1, amount);
            assertEq(_executed(opId), alone, "c1 alone runs exactly when the op fits the window");
            if (alone) {
                if (spent == 0) start = _now();
                spent += amount;
            } else if (gaps[i] % 2 == 0) {
                vm.prank(c2);
                C.confirm(opId);
                cosigned += amount;
            }
            assertLe(spent, LIMIT, "single-signature spend fits the allowance");
            (uint64 chainStart, uint128 chainSpent, uint128 remaining) = C.spendWindow();
            assertEq(chainSpent, spent);
            assertEq(remaining, LIMIT - spent);
            if (spent != 0) assertEq(chainStart, start);
        }
        assertGe(usdc.balanceOf(payee), cosigned);
    }
}
