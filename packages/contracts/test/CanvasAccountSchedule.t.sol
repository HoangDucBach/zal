// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {InvoiceStatus, Leg, LegKind, MemberRole, Schedule, ScheduleKind} from "../src/lib/ZalTypes.sol";
import {ZalInvoice} from "../src/ZalInvoice.sol";
import {ReentrantVault} from "./support/Mocks.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

/// @dev Scheduled payments. The club `C` needs two confirmations to create a schedule; `payee` is a
/// plain address that receives Transfer runs.
contract CanvasAccountScheduleTest is ZalTestBase {
    uint128 internal constant AMOUNT = 100e6;

    address internal payee = makeAddr("payee");

    function _now() internal view returns (uint64) {
        return uint64(vm.getBlockTimestamp());
    }

    function _transferCall(address recipient, uint128 amount, uint64 start, uint32 interval, uint32 runs)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(
            CanvasAccount.createSchedule, (ScheduleKind.Transfer, recipient, 0, amount, start, interval, runs)
        );
    }

    function _payInvoiceCall(uint256 invoiceId, uint64 start, uint32 interval, uint32 runs)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeCall(
            CanvasAccount.createSchedule, (ScheduleKind.PayInvoice, address(0), invoiceId, 0, start, interval, runs)
        );
    }

    function _schedule(bytes memory data) internal returns (uint256 id) {
        _clubExec(data);
        return C.scheduleCount();
    }

    /// @dev `AMOUNT` to `payee` every 60 s for 3 runs, first due in 60 s.
    function _recurring() internal returns (uint256 id, uint64 start) {
        start = _now() + 60;
        id = _schedule(_transferCall(payee, AMOUNT, start, 60, 3));
    }

    /// @dev c1 submits, and c2's confirmation, which would execute the op, reverts with `err`.
    function _expectCreateRevert(bytes memory data, bytes memory err) internal {
        vm.prank(c1);
        uint256 opId = C.submit(data);
        vm.expectRevert(err);
        vm.prank(c2);
        C.confirm(opId);
    }

    /// @dev An op priced at 0 needs one confirmation, so it executes, and reverts, inside `submit`.
    function _expectSubmitRevert(bytes memory data, bytes memory err) internal {
        vm.expectRevert(err);
        vm.prank(c1);
        C.submit(data);
    }

    function _run(uint256 id) internal {
        vm.prank(stranger);
        C.runSchedule(id);
    }

    function _expectRunRevert(uint256 id, bytes memory err) internal {
        vm.expectRevert(err);
        vm.prank(stranger);
        C.runSchedule(id);
    }

    // ---- Acceptance tests

    function test_AT21_strangerRunsARecurringTransferOncePerDueTime() public {
        uint64 start = _now() + 60;
        usdc.mint(address(C), 1_000e6);
        vm.prank(c1);
        uint256 opId = C.submit(_transferCall(address(D), AMOUNT, start, 60, 3));
        assertEq(C.getOp(opId).amount, 300e6, "ZR-SCH-01: the op is priced at every run");
        assertEq(C.scheduleCount(), 0, "one confirmation is not enough");
        vm.expectEmit(address(C));
        emit CanvasAccount.ScheduleCreated(1, ScheduleKind.Transfer, address(D), 0, AMOUNT, start, 60, 3);
        vm.prank(c2);
        C.confirm(opId);
        assertEq(C.scheduleCount(), 1);

        vm.warp(start - 1);
        _expectRunRevert(1, abi.encodeWithSelector(CanvasAccount.ScheduleNotDue.selector, 1, start));

        for (uint32 i; i < 3; ++i) {
            uint64 dueAt = start + i * 60;
            vm.warp(dueAt);
            vm.expectEmit(address(C));
            emit CanvasAccount.ScheduleRan(1, dueAt, AMOUNT, 2 - i);
            _run(1);
            assertEq(usdc.balanceOf(address(D)), uint256(AMOUNT) * (i + 1), "paid once");
            if (i < 2) {
                _expectRunRevert(1, abi.encodeWithSelector(CanvasAccount.ScheduleNotDue.selector, 1, dueAt + 60));
            }
        }

        vm.warp(start + 240);
        _expectRunRevert(1, abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, 1));
        assertEq(usdc.balanceOf(address(D)), 300e6, "3 payments of 100");
        assertEq(usdc.balanceOf(address(C)), 700e6);
        assertEq(usdc.balanceOf(stranger), 0);
        Schedule memory s = C.getSchedule(1);
        assertEq(s.remaining, 0);
        assertEq(s.nextAt, start + 180);
        assertFalse(s.active);
    }

    function test_AT22_keeperPaysAnApprovedInvoiceThroughTheSellersRoute() public {
        _setTaxRoute();
        uint256 invoiceId = _approvedInvoice();
        uint64 start = _now() + 60;
        vm.prank(c1);
        uint256 opId = C.submit(_payInvoiceCall(invoiceId, start, 0, 1));
        assertEq(C.getOp(opId).amount, FACE, "ZR-SCH-01: the op is priced at the face value");
        vm.expectEmit(address(C));
        emit CanvasAccount.ScheduleCreated(
            1, ScheduleKind.PayInvoice, address(0), invoiceId, uint128(FACE), start, 0, 1
        );
        vm.prank(c2);
        C.confirm(opId);

        vm.warp(start);
        vm.expectEmit(address(invoices));
        emit ZalInvoice.InvoicePaid(invoiceId, address(C), address(D), uint128(FACE));
        vm.expectEmit(address(C));
        emit CanvasAccount.ScheduleRan(1, start, uint128(FACE), 0);
        vm.prank(keeper);
        C.runSchedule(1);

        assertEq(uint8(_invoice(invoiceId).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(tax), FACE / 10, "10% through D's route");
        assertEq(usdc.balanceOf(address(D)), FACE - FACE / 10);
        assertEq(usdc.balanceOf(address(C)), 0);
        assertEq(usdc.allowance(address(C), address(invoices)), 0, "no allowance left behind");
        assertFalse(C.getSchedule(1).active);
    }

    function test_AT23_runWithAShortBalanceRevertsAndStaysDue() public {
        (uint256 id, uint64 start) = _recurring();
        usdc.mint(address(C), AMOUNT - 1);
        vm.warp(start + 30);

        _expectRunRevert(
            id, abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(C), AMOUNT - 1, AMOUNT)
        );
        Schedule memory s = C.getSchedule(id);
        assertEq(s.remaining, 3, "no run consumed");
        assertEq(s.nextAt, start);
        assertTrue(s.active);

        usdc.mint(address(C), 1);
        _run(id);
        assertEq(usdc.balanceOf(payee), AMOUNT);
        assertEq(C.getSchedule(id).remaining, 2);
    }

    function test_AT24_cancelledScheduleNeverRuns() public {
        (uint256 id, uint64 start) = _recurring();
        usdc.mint(address(C), 1_000e6);
        vm.warp(start);
        _run(id);

        vm.expectEmit(address(C));
        emit CanvasAccount.ScheduleCancelled(id, c2);
        vm.prank(c2);
        C.cancelSchedule(id);

        vm.warp(start + 1 days);
        _expectRunRevert(id, abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, id));
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, id));
        vm.prank(c1);
        C.runSchedule(id);
        assertEq(usdc.balanceOf(payee), AMOUNT, "only the run before the cancel");
        assertFalse(C.getSchedule(id).active);
    }

    function test_AT25_createRejectsBadTiming() public {
        uint64 t = _now();
        _expectCreateRevert(
            _transferCall(payee, AMOUNT, t + 59, 60, 3),
            abi.encodeWithSelector(CanvasAccount.ScheduleStartTooSoon.selector, t + 59, t + 60)
        );
        _expectCreateRevert(
            _transferCall(payee, AMOUNT, t + 60, 30, 3),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 30, 3)
        );
        _expectSubmitRevert(
            _transferCall(payee, AMOUNT, t + 60, 60, 0),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 60, 0)
        );
        assertEq(C.scheduleCount(), 0);
    }

    // ---- Creation

    /// @dev ZR-SCH-02 at its edges.
    function test_createTimingBoundaries() public {
        uint64 start = _now() + 60;
        _schedule(_transferCall(payee, AMOUNT, start, 60, 1000));
        _schedule(_transferCall(payee, AMOUNT, start, 60, 1));
        _schedule(_transferCall(payee, AMOUNT, start, 0, 1));
        assertEq(C.scheduleCount(), 3, "the least start, the least interval and the most runs are accepted");

        _expectCreateRevert(
            _transferCall(payee, AMOUNT, start, 60, 1001),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 60, 1001)
        );
        _expectCreateRevert(
            _transferCall(payee, AMOUNT, start, 59, 2),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 59, 2)
        );
        _expectCreateRevert(
            _transferCall(payee, AMOUNT, start, 0, 2),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 0, 2)
        );
        _expectSubmitRevert(
            _transferCall(payee, AMOUNT, start, 0, 0),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 0, 0)
        );
    }

    /// @dev The start is measured from the confirmation that creates the schedule, not from `submit`.
    function test_startIsCheckedWhenTheOpExecutes() public {
        uint64 start = _now() + 60;
        vm.prank(c1);
        uint256 opId = C.submit(_transferCall(payee, AMOUNT, start, 0, 1));
        vm.warp(_now() + 1);
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.ScheduleStartTooSoon.selector, start, start + 1));
        vm.prank(c2);
        C.confirm(opId);
    }

    function testFuzz_createAcceptsExactlyTheAllowedTiming(uint64 delay, uint32 interval, uint32 runs) public {
        delay = uint64(bound(delay, 0, 365 days));
        interval = uint32(bound(interval, 0, 200));
        runs = uint32(bound(runs, 0, 1100));
        uint64 start = _now() + delay;
        bool allowed;
        if (delay >= 60) {
            if (interval == 0) allowed = runs == 1;
            else allowed = interval >= 60 && runs >= 1 && runs <= 1000;
        }

        if (runs == 0) {
            vm.expectRevert();
            vm.prank(c1);
            C.submit(_transferCall(payee, AMOUNT, start, interval, runs));
            return;
        }
        vm.prank(c1);
        uint256 opId = C.submit(_transferCall(payee, AMOUNT, start, interval, runs));
        assertEq(C.getOp(opId).amount, uint256(AMOUNT) * runs, "priced at every run");
        if (!allowed) vm.expectRevert();
        vm.prank(c2);
        C.confirm(opId);
        if (!allowed) {
            assertEq(C.scheduleCount(), 0);
            return;
        }
        Schedule memory s = C.getSchedule(1);
        assertEq(uint8(s.kind), uint8(ScheduleKind.Transfer));
        assertEq(s.recipient, payee);
        assertEq(s.invoiceId, 0);
        assertEq(s.amount, AMOUNT);
        assertEq(s.nextAt, start);
        assertEq(s.interval, interval);
        assertEq(s.remaining, runs);
        assertTrue(s.active);
    }

    /// @dev ZR-SCH-01. Three runs of 100 are over a 250 limit although one run is under it.
    function test_transferScheduleIsGatedByItsTotal() public {
        vm.prank(c1);
        C.setPolicy(2, 250e6);
        vm.prank(c1);
        C.submit(_transferCall(payee, AMOUNT, _now() + 60, 60, 3));
        assertEq(C.scheduleCount(), 0, "300 needs the second approver");
        vm.prank(c1);
        C.submit(_transferCall(payee, AMOUNT, _now() + 60, 60, 2));
        assertEq(C.scheduleCount(), 1, "200 is within the limit");
    }

    /// @dev ZR-SCH-01. The `amount` argument of a PayInvoice schedule is ignored, so it cannot lower the price.
    function test_payInvoiceScheduleIsGatedByTheFaceValue() public {
        uint256 invoiceId = _approvedInvoice();
        vm.prank(c1);
        C.setPolicy(2, uint128(FACE) - 1);
        vm.prank(c1);
        uint256 opId = C.submit(_payInvoiceCall(invoiceId, _now() + 60, 0, 1));
        assertEq(C.getOp(opId).amount, FACE);
        assertEq(C.scheduleCount(), 0, "the face value is over the limit");
    }

    /// @dev ZR-SCH-03.
    function test_transferRecipientMustBeAnotherNonzeroAddress() public {
        uint64 start = _now() + 60;
        _expectCreateRevert(
            _transferCall(address(0), AMOUNT, start, 0, 1),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleRecipient.selector, address(0))
        );
        _expectCreateRevert(
            _transferCall(address(C), AMOUNT, start, 0, 1),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleRecipient.selector, address(C))
        );
    }

    /// @dev ZR-SCH-03.
    function test_payInvoiceScheduleRunsOnceOnly() public {
        uint256 invoiceId = _approvedInvoice();
        _expectCreateRevert(
            _payInvoiceCall(invoiceId, _now() + 60, 60, 2),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 60, 2)
        );
        _expectCreateRevert(
            _payInvoiceCall(invoiceId, _now() + 60, 60, 1),
            abi.encodeWithSelector(CanvasAccount.InvalidScheduleTiming.selector, 60, 1)
        );
    }

    /// @dev ZR-SCH-03.
    function test_payInvoiceScheduleNeedsAnApprovedInvoiceThisAccountBuys() public {
        uint256 relId = _relateDemo();
        uint256 issued = _issue(relId, FACE);
        _expectCreateRevert(
            _payInvoiceCall(issued, _now() + 60, 0, 1),
            abi.encodeWithSelector(CanvasAccount.InvoiceNotSchedulable.selector, issued)
        );
        _expectSubmitRevert(
            _payInvoiceCall(99, _now() + 60, 0, 1),
            abi.encodeWithSelector(CanvasAccount.InvoiceNotSchedulable.selector, 99)
        );

        // D is the seller of this Approved invoice, not its buyer.
        _clubApprove(issued, 0);
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.InvoiceNotSchedulable.selector, issued));
        vm.prank(d);
        D.submit(_payInvoiceCall(issued, _now() + 60, 0, 1));
    }

    function test_payInvoiceScheduleStoresTheFaceValueAndNoRecipient() public {
        uint256 invoiceId = _approvedInvoice();
        uint64 start = _now() + 60;
        uint256 id = _schedule(
            abi.encodeCall(CanvasAccount.createSchedule, (ScheduleKind.PayInvoice, stranger, invoiceId, 1, start, 0, 1))
        );
        Schedule memory s = C.getSchedule(id);
        assertEq(uint8(s.kind), uint8(ScheduleKind.PayInvoice));
        assertEq(s.recipient, address(0));
        assertEq(s.invoiceId, invoiceId);
        assertEq(s.amount, FACE);
    }

    function test_createScheduleIsReachedOnlyThroughAnApprovedOp() public {
        uint64 start = _now() + 60;
        vm.expectRevert(CanvasAccount.NotSelf.selector);
        vm.prank(c1);
        C.createSchedule(ScheduleKind.Transfer, payee, 0, AMOUNT, start, 0, 1);
        vm.expectRevert(CanvasAccount.NotSelf.selector);
        vm.prank(stranger);
        C.createSchedule(ScheduleKind.Transfer, stranger, 0, AMOUNT, start, 0, 1);
        vm.expectRevert(CanvasAccount.NotApprover.selector);
        vm.prank(stranger);
        C.submit(_transferCall(stranger, AMOUNT, start, 0, 1));
    }

    function test_submitRejectsMalformedScheduleCalls() public {
        bytes memory data = _transferCall(payee, AMOUNT, _now() + 60, 0, 1);
        vm.startPrank(c1);
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        C.submit(bytes.concat(data, bytes32(0)));
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        C.submit(abi.encodePacked(CanvasAccount.createSchedule.selector, new bytes(223)));
        // Kind 2 is not a ScheduleKind.
        vm.expectRevert();
        C.submit(abi.encodeWithSelector(CanvasAccount.createSchedule.selector, 2, payee, 0, AMOUNT, _now() + 60, 0, 1));
        vm.stopPrank();
        assertEq(C.opCount(), 0);
    }

    // ---- Running

    /// @dev ZR-SCH-05. The caller of `runSchedule` passes an id and nothing else.
    function test_strangerCanRunButCannotChangeAmountOrTarget() public {
        (uint256 id, uint64 start) = _recurring();
        usdc.mint(address(C), 1_000e6);

        vm.expectRevert(CanvasAccount.NotApprover.selector);
        vm.prank(stranger);
        C.cancelSchedule(id);

        vm.warp(start);
        _run(id);
        assertEq(usdc.balanceOf(payee), AMOUNT, "the approved amount to the approved target");
        assertEq(usdc.balanceOf(address(C)), 1_000e6 - AMOUNT);
        assertEq(usdc.balanceOf(stranger), 0);
        Schedule memory s = C.getSchedule(id);
        assertEq(s.recipient, payee);
        assertEq(s.amount, AMOUNT);
    }

    /// @dev ZR-SCH-06. A schedule that fell behind runs once per missed due time and no more.
    function test_lateScheduleCatchesUpOncePerDueTime() public {
        (uint256 id, uint64 start) = _recurring();
        usdc.mint(address(C), 1_000e6);
        vm.warp(start + 90);
        _run(id);
        _run(id);
        _expectRunRevert(id, abi.encodeWithSelector(CanvasAccount.ScheduleNotDue.selector, id, start + 120));
        assertEq(usdc.balanceOf(payee), 2 * AMOUNT);
    }

    function testFuzz_runsPayOncePerDueTimeAndAtMostRunsTimes(uint32 interval, uint32 runs, uint256 seed) public {
        interval = uint32(bound(interval, 60, 1 days));
        runs = uint32(bound(runs, 1, 12));
        uint64 start = _now() + 60;
        uint256 id = _schedule(_transferCall(payee, AMOUNT, start, interval, runs));
        usdc.mint(address(C), uint256(AMOUNT) * 100);

        uint256 paid;
        for (uint256 i; i < 40; ++i) {
            seed = uint256(keccak256(abi.encode(seed)));
            vm.warp(_now() + seed % (2 * uint256(interval)));
            uint256 dueTimesPassed = _now() < start ? 0 : (_now() - start) / interval + 1;
            uint256 owed = dueTimesPassed < runs ? dueTimesPassed : runs;
            vm.prank(stranger);
            try C.runSchedule(id) {
                ++paid;
            } catch {}
            assertLe(paid, owed, "ZR-SCH-06: never ahead of the due times");
            assertEq(paid == owed, paid == runs || _now() < C.getSchedule(id).nextAt, "a due run never reverts");
            assertEq(usdc.balanceOf(payee), paid * AMOUNT);
            Schedule memory s = C.getSchedule(id);
            assertEq(paid + s.remaining, runs, "INV-11 runs");
            assertEq(s.nextAt, start + paid * uint256(interval), "INV-11 nextAt");
            assertEq(s.active, s.remaining != 0);
        }
    }

    function test_unknownScheduleDoesNotRun() public {
        _expectRunRevert(1, abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, 1));
        _expectRunRevert(0, abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, 0));
        assertFalse(C.getSchedule(1).active);
    }

    /// @dev Creation is the spend control. A member or policy change makes pending ops stale (ZR-ACC-05) but
    /// leaves an approved schedule running.
    function test_memberAndPolicyChangesDoNotStopAnApprovedSchedule() public {
        (uint256 id, uint64 start) = _recurring();
        usdc.mint(address(C), 1_000e6);
        vm.startPrank(c1);
        C.setMember(c3, MemberRole.None);
        C.setPolicy(2, 1);
        vm.stopPrank();

        vm.warp(start + 60);
        _run(id);
        _run(id);
        assertEq(usdc.balanceOf(payee), 2 * AMOUNT);
    }

    // ---- Cancelling

    /// @dev ZR-SCH-04.
    function test_cancelNeedsACurrentApproverOrAdmin() public {
        (uint256 first,) = _recurring();
        (uint256 second,) = _recurring();
        vm.prank(c1);
        C.setMember(makeAddr("viewer"), MemberRole.Viewer);
        vm.expectRevert(CanvasAccount.NotApprover.selector);
        vm.prank(makeAddr("viewer"));
        C.cancelSchedule(first);

        vm.prank(c1);
        C.cancelSchedule(first);
        assertFalse(C.getSchedule(first).active);
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, first));
        vm.prank(c2);
        C.cancelSchedule(first);

        vm.prank(c1);
        C.setMember(c3, MemberRole.None);
        vm.expectRevert(CanvasAccount.NotApprover.selector);
        vm.prank(c3);
        C.cancelSchedule(second);
        assertTrue(C.getSchedule(second).active);
    }

    function test_finishedScheduleCannotBeCancelled() public {
        uint64 start = _now() + 60;
        uint256 id = _schedule(_transferCall(payee, AMOUNT, start, 0, 1));
        usdc.mint(address(C), AMOUNT);
        vm.warp(start);
        _run(id);
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.ScheduleNotActive.selector, id));
        vm.prank(c1);
        C.cancelSchedule(id);
    }

    // ---- PayInvoice runs

    /// @dev The invoice was paid by a gated op first. The run reverts in ZalInvoice, pays nothing, and the
    /// schedule stays until it is cancelled.
    function test_payInvoiceRunRevertsOnceTheInvoiceIsPaidAnotherWay() public {
        uint256 invoiceId = _approvedInvoice();
        uint64 start = _now() + 60;
        uint256 id = _schedule(_payInvoiceCall(invoiceId, start, 0, 1));
        _clubPay(invoiceId);
        usdc.mint(address(C), FACE);

        vm.warp(start);
        _expectRunRevert(id, abi.encodeWithSelector(ZalInvoice.WrongStatus.selector, invoiceId, InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(C)), FACE, "nothing paid twice");
        assertEq(usdc.balanceOf(address(D)), FACE);
        assertEq(usdc.allowance(address(C), address(invoices)), 0);
        assertTrue(C.getSchedule(id).active);

        vm.prank(c3);
        C.cancelSchedule(id);
        assertFalse(C.getSchedule(id).active);
    }

    function test_payInvoiceRunOnAnEscrowedInvoicePaysFromEscrow() public {
        uint256 invoiceId = _escrowedInvoice();
        uint64 start = _now() + 60;
        uint256 id = _schedule(_payInvoiceCall(invoiceId, start, 0, 1));
        usdc.mint(address(C), 1e6);

        vm.warp(start);
        _run(id);
        assertEq(uint8(_invoice(invoiceId).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(D)), FACE);
        assertEq(usdc.balanceOf(address(invoices)), 0, "the escrow was released");
        assertEq(usdc.balanceOf(address(C)), 1e6, "the account paid nothing more");
        assertEq(usdc.allowance(address(C), address(invoices)), 0);
    }

    /// @dev INV-06. The pool holds the NFT, so the run repays the pool and the seller gets the reserve.
    function test_payInvoiceRunOnAFundedInvoiceRepaysThePool() public {
        _lpDeposit(10_000e6);
        uint256 invoiceId = _approvedInvoice();
        _enrol(address(C), FACE);
        _advance(invoiceId);
        uint256 principal = pool.advanceOf(invoiceId).principal;
        uint256 fee = pool.advanceOf(invoiceId).fee;
        uint64 start = _now() + 60;
        uint256 id = _schedule(_payInvoiceCall(invoiceId, start, 0, 1));

        vm.warp(start);
        _run(id);
        assertEq(uint8(_invoice(invoiceId).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(pool)), 10_000e6 + fee, "principal and fee back in the pool");
        assertEq(usdc.balanceOf(address(D)), FACE - fee, "the advance plus the reserve");
        assertEq(pool.outstanding(), 0);
        assertEq(principal, 4_000e6);
    }

    // ---- Reentrancy

    /// @dev A PayInvoice run reaches the seller's route, where a vault leg gets control while the buyer account
    /// is mid-run. It cannot repeat the run, start another due schedule, or cancel one.
    function test_recipientReenteringDuringARunCannotRunAnything() public {
        ReentrantVault rv = new ReentrantVault(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(rv), true);
        Leg[] memory legs = new Leg[](1);
        legs[0] = Leg({kind: LegKind.Vault, target: address(rv), bps: 10_000});
        _setRoute(legs);

        uint256 invoiceId = _approvedInvoice();
        usdc.mint(address(C), 1_000e6);
        uint64 start = _now() + 60;
        uint256 invoiceRun = _schedule(_payInvoiceCall(invoiceId, start, 0, 1));
        uint256 transferRun = _schedule(_transferCall(address(rv), AMOUNT, start, 60, 3));
        rv.addAttack(address(C), abi.encodeCall(CanvasAccount.runSchedule, (invoiceRun)));
        rv.addAttack(address(C), abi.encodeCall(CanvasAccount.runSchedule, (transferRun)));
        rv.addAttack(address(C), abi.encodeCall(CanvasAccount.cancelSchedule, (transferRun)));

        vm.warp(start + 120);
        _run(invoiceRun);

        assertEq(rv.attempts(), 3, "the vault was called and tried everything");
        assertEq(rv.successes(), 0, "nothing the vault tried went through");
        assertEq(usdc.balanceOf(address(rv)), FACE, "the invoice and nothing more");
        assertEq(usdc.balanceOf(address(C)), 1_000e6);
        assertEq(C.getSchedule(transferRun).remaining, 3);
        assertTrue(C.getSchedule(transferRun).active);

        // The same call from outside a run is allowed, so the guard is what stopped it.
        vm.prank(address(rv));
        C.runSchedule(transferRun);
        assertEq(usdc.balanceOf(address(rv)), FACE + AMOUNT);
    }

    function test_runScheduleRejectsReentryWithTheGuardError() public {
        ReentrantProbe probe = new ReentrantProbe(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(probe), true);
        Leg[] memory legs = new Leg[](1);
        legs[0] = Leg({kind: LegKind.Vault, target: address(probe), bps: 10_000});
        _setRoute(legs);

        uint256 invoiceId = _approvedInvoice();
        usdc.mint(address(C), AMOUNT);
        uint64 start = _now() + 60;
        uint256 invoiceRun = _schedule(_payInvoiceCall(invoiceId, start, 0, 1));
        uint256 transferRun = _schedule(_transferCall(payee, AMOUNT, start, 0, 1));
        probe.arm(address(C), abi.encodeCall(CanvasAccount.runSchedule, (transferRun)));

        vm.warp(start);
        _run(invoiceRun);
        assertEq(
            bytes4(probe.lastRevert()),
            ReentrancyGuardTransient.ReentrancyGuardReentrantCall.selector,
            "the reentrancy guard refused the second run"
        );
        assertEq(usdc.balanceOf(payee), 0);
    }
}

/// @dev Stands in for a vault. Inside `deposit` it makes one call and keeps the revert data.
contract ReentrantProbe {
    address public immutable asset;
    address private target;
    bytes private data;
    bytes public lastRevert;

    constructor(address asset_) {
        asset = asset_;
    }

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
    }

    function deposit(uint256, address) external returns (uint256) {
        (bool ok, bytes memory returndata) = target.call(data);
        if (!ok) lastRevert = returndata;
        return 0;
    }
}
