// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {CanvasAccount} from "../src/CanvasAccount.sol";
import {Budget, InvoiceStatus, Leg, LegKind, MemberRole} from "../src/lib/ZalTypes.sol";
import {ZalFundingPool} from "../src/ZalFundingPool.sol";
import {ZalInvoice} from "../src/ZalInvoice.sol";
import {FlakyVault, GasBurnVault, NoReturnVault, ReentrantVault, ShortReturnVault} from "./support/Mocks.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

contract CanvasAccountTest is ZalTestBase {
    uint256 internal constant EVENTS_BUDGET = 1;
    /// @dev 80% of FACE.
    uint256 internal constant PRINCIPAL_OF_FACE = 4_000e6;

    event PaymentRouted(uint256 indexed invoiceId, uint256 amount, uint256[] legAmounts);
    event LegFailed(uint256 indexed invoiceId, uint256 legIndex, uint256 amount);
    event OpSubmitted(uint256 indexed opId, bytes4 indexed selector, uint256 amount, address indexed by, bytes data);

    function _receive(CanvasAccount account, uint256 invoiceId, uint256 amount) internal {
        usdc.mint(address(account), amount);
        vm.prank(address(invoices));
        account.receivePayment(invoiceId, amount);
    }

    /// @dev Allows `v` and makes it D's whole route.
    function _routeAllToVault(address v) internal {
        vm.prank(owner);
        factory.setAllowedVault(v, true);
        Leg[] memory legs = new Leg[](1);
        legs[0] = Leg({kind: LegKind.Vault, target: v, bps: 10_000});
        _setRoute(legs);
    }

    function _withdrawCall(address to, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeCall(CanvasAccount.withdraw, (to, amount));
    }

    // ---- Acceptance tests

    function test_AT01_routeSplitsTenPercentToTax() public {
        _setTaxRoute();
        _receive(D, 1, 1_000e6);
        assertEq(usdc.balanceOf(tax), 100e6, "tax leg");
        assertEq(usdc.balanceOf(address(D)), 900e6, "held");
    }

    function test_AT06_budgetedApprovalByTwoMembers() public {
        uint256 relId = _relateDemo();
        uint256 first = _issue(relId, FACE);
        uint256 second = _issue(relId, FACE);
        vm.prank(c1);
        C.setBudget(EVENTS_BUDGET, 6_000e6, 0);

        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.approveInvoice, (first, EVENTS_BUDGET)));
        assertEq(uint8(_invoice(first).status), uint8(InvoiceStatus.Issued), "one confirmation is not enough");
        vm.prank(c2);
        C.confirm(opId);

        assertEq(uint8(_invoice(first).status), uint8(InvoiceStatus.Approved));
        (, uint128 used,,) = C.budgets(EVENTS_BUDGET);
        assertEq(used, FACE, "budget used");

        vm.prank(c1);
        opId = C.submit(abi.encodeCall(CanvasAccount.approveInvoice, (second, EVENTS_BUDGET)));
        vm.expectRevert(
            abi.encodeWithSelector(CanvasAccount.BudgetExceeded.selector, EVENTS_BUDGET, FACE, FACE, 6_000e6)
        );
        vm.prank(c2);
        C.confirm(opId);
        assertEq(uint8(_invoice(second).status), uint8(InvoiceStatus.Issued));
    }

    function test_AT07_escrowNeedsTwoDistinctApprovers() public {
        uint256 id = _approvedInvoice();
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.escrowInvoice, (id)));

        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.AlreadyConfirmed.selector, opId));
        vm.prank(c1);
        C.confirm(opId);
        assertEq(usdc.balanceOf(address(invoices)), 0, "not escrowed yet");

        vm.prank(c2);
        C.confirm(opId);
        assertEq(usdc.balanceOf(address(invoices)), FACE, "invoice contract holds the escrow");
        assertEq(_invoice(id).escrowed, FACE);
        assertEq(usdc.balanceOf(address(C)), 0);
    }

    function test_AT13_memberChangeInvalidatesPendingOp() public {
        usdc.mint(address(C), 100e6);
        vm.prank(c1);
        uint256 opId = C.submit(_withdrawCall(stranger, 100e6));

        vm.prank(c1);
        C.setMember(c2, MemberRole.None);

        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.OpStale.selector, opId));
        vm.prank(c3);
        C.confirm(opId);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_AT15_failingVaultLegFallsBackToHold() public {
        FlakyVault flaky = new FlakyVault(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(flaky), true);
        Leg[] memory legs = new Leg[](1);
        legs[0] = Leg({kind: LegKind.Vault, target: address(flaky), bps: 10_000});
        _setRoute(legs);

        uint256 id = _approvedInvoice();
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.expectEmit(address(D));
        emit LegFailed(id, 0, FACE);
        vm.prank(c2);
        C.confirm(opId);

        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(D)), FACE, "held instead");
        assertEq(usdc.allowance(address(D), address(flaky)), 0, "no allowance left behind");
    }

    function test_AT16_receivePaymentRejectsOtherCallers() public {
        usdc.mint(address(D), 1_000e6);
        vm.expectRevert(CanvasAccount.NotSettlement.selector);
        vm.prank(stranger);
        D.receivePayment(1, 1_000e6);
        vm.expectRevert(CanvasAccount.NotSettlement.selector);
        vm.prank(d);
        D.receivePayment(1, 1_000e6);
    }

    function test_AT19_sellerAccountSettlesItsOwnEscrowedInvoiceAfterDueDate() public {
        _setTaxRoute();
        _lpDeposit(10_000e6);
        uint256 relId = _relateDemo();
        uint256 unfunded = _issue(relId, FACE);
        uint256 funded = _issue(relId, FACE);
        _clubApprove(unfunded, 0);
        _clubApprove(funded, 0);
        usdc.mint(address(C), 2 * FACE);
        _clubEscrow(unfunded);
        _clubEscrow(funded);
        _advance(funded);
        uint256 principal = pool.advanceOf(funded).principal;
        uint256 fee = pool.advanceOf(funded).fee;
        uint256 reserve = FACE - principal - fee;
        vm.warp(_invoice(funded).dueDate);

        vm.prank(d);
        D.submit(abi.encodeCall(CanvasAccount.payInvoice, (unfunded)));
        assertEq(uint8(_invoice(unfunded).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(tax), FACE / 10, "10% of the face to tax");
        assertEq(usdc.balanceOf(address(D)), principal + FACE - FACE / 10, "the advance plus 90% of the face");

        vm.prank(d);
        D.submit(abi.encodeCall(CanvasAccount.payInvoice, (funded)));
        assertEq(uint8(_invoice(funded).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(pool)), 10_000e6 + fee, "pool keeps principal and fee");
        assertEq(usdc.balanceOf(tax), FACE / 10 + reserve / 10, "10% of the reserve to tax");
        assertEq(
            usdc.balanceOf(address(D)),
            principal + FACE - FACE / 10 + reserve - reserve / 10,
            "90% of the reserve through D's route"
        );
        assertEq(usdc.balanceOf(address(invoices)), 0, "both escrows released");
        assertEq(pool.outstanding(), 0);
    }

    function test_AT20_vaultLegThatReturnsNoDataFallsBackToHold() public {
        NoReturnVault silent = new NoReturnVault(address(usdc));
        _routeAllToVault(address(silent));

        uint256 id = _approvedInvoice();
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.expectEmit(address(D));
        emit LegFailed(id, 0, FACE);
        vm.prank(c2);
        C.confirm(opId);

        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(D)), FACE, "held instead");
        assertEq(usdc.allowance(address(D), address(silent)), 0, "no allowance left behind");
    }

    /// @dev ZR-ACC-09. 31 bytes is one short of the word a deposit returns.
    function test_vaultLegThatReturnsShortDataFallsBackToHold() public {
        ShortReturnVault short = new ShortReturnVault(address(usdc));
        _routeAllToVault(address(short));

        uint256 id = _approvedInvoice();
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.expectEmit(address(D));
        emit LegFailed(id, 0, FACE);
        vm.prank(c2);
        C.confirm(opId);

        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(D)), FACE, "held instead");
        assertEq(usdc.allowance(address(D), address(short)), 0, "no allowance left behind");
    }

    /// @dev ZR-ACC-09. The leg takes 63/64 of the gas, and the 1/64 left must finish the settlement.
    function test_vaultLegThatBurnsGasFallsBackToHold() public {
        GasBurnVault burner = new GasBurnVault(address(usdc));
        _routeAllToVault(address(burner));
        uint256 id = _escrowedInvoice();
        vm.warp(_invoice(id).dueDate);

        vm.expectEmit(address(D));
        emit LegFailed(id, 0, FACE);
        vm.prank(stranger);
        invoices.payInvoice{gas: 3_000_000}(id);

        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(D)), FACE, "held instead");
        assertEq(usdc.allowance(address(D), address(burner)), 0, "no allowance left behind");
    }

    /// @dev ZR-ACC-10 safety. `receivePayment` holds no reentrancy guard, so a vault leg is called while the
    /// account is unlocked and mid-route. The vault is not a member, so every account action it tries fails,
    /// and ZalInvoice and ZalFundingPool are locked for the whole settlement.
    function test_vaultLegReenteringDuringRoutingCanDoNothing() public {
        ReentrantVault rv = new ReentrantVault(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(rv), true);
        Leg[] memory legs = new Leg[](2);
        legs[0] = Leg({kind: LegKind.Vault, target: address(rv), bps: 5_000});
        legs[1] = Leg({kind: LegKind.Hold, target: address(0), bps: 5_000});
        _setRoute(legs);

        _lpDeposit(10_000e6);
        uint256 relId = _relateDemo();
        uint256 funded = _issue(relId, FACE);
        uint256 other = _issue(relId, FACE);
        _clubApprove(funded, 0);
        _clubApprove(other, 0);
        usdc.mint(address(C), 2 * FACE);
        _clubEscrow(funded);
        _clubEscrow(other);
        _advance(funded);
        uint256 reserve = FACE - PRINCIPAL_OF_FACE - pool.advanceOf(funded).fee;

        // A pending op for the vault to try to confirm, revoke or replay.
        address d2 = makeAddr("d2");
        vm.startPrank(d);
        D.setMember(d2, MemberRole.Approver);
        D.setPolicy(2, 0);
        uint256 opId = D.submit(_withdrawCall(address(rv), 1e6));
        vm.stopPrank();

        address acct = address(D);
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.receivePayment, (funded, 1e6)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.submit, (_withdrawCall(address(rv), 1e6))));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.confirm, (opId)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.revoke, (opId)));
        rv.addAttack(acct, _withdrawCall(address(rv), 1e6));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.payInvoice, (other)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.escrowInvoice, (other)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.approveInvoice, (other, 0)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.setRoute, (new Leg[](0))));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.setMember, (address(rv), MemberRole.Admin)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.setPolicy, (1, 0)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.requestAdvance, (other)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.cancelInvoice, (other)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.vaultDeposit, (address(rv), 1e6)));
        rv.addAttack(acct, abi.encodeCall(CanvasAccount.vaultRedeem, (address(rv), 1)));
        // Open to any caller once due, so only the settlement's own guard stops these.
        rv.addAttack(address(invoices), abi.encodeCall(ZalInvoice.payInvoice, (other)));
        rv.addAttack(address(invoices), abi.encodeCall(ZalInvoice.payInvoice, (funded)));
        rv.addAttack(address(pool), abi.encodeCall(ZalFundingPool.advance, (other)));
        rv.addAttack(address(pool), abi.encodeCall(ZalFundingPool.onRepaid, (funded, FACE)));

        vm.warp(_invoice(funded).dueDate);
        vm.prank(stranger);
        invoices.payInvoice(funded);

        assertEq(rv.attempts(), 19, "the vault was called and tried everything");
        assertEq(rv.successes(), 0, "nothing the vault tried went through");
        assertEq(uint8(_invoice(funded).status), uint8(InvoiceStatus.Paid));
        assertEq(uint8(_invoice(other).status), uint8(InvoiceStatus.Approved));
        assertEq(invoices.ownerOf(other), address(D));
        assertEq(rv.balanceOf(address(D)), reserve / 2, "the vault leg got its half");
        assertEq(usdc.balanceOf(address(rv)), reserve / 2, "and nothing more");
        assertEq(usdc.balanceOf(address(D)), PRINCIPAL_OF_FACE + reserve - reserve / 2);
        assertEq(usdc.allowance(address(D), address(rv)), 0);
        assertEq(
            usdc.balanceOf(address(pool)), 10_000e6 + FACE - PRINCIPAL_OF_FACE - reserve, "pool kept principal and fee"
        );
        assertEq(pool.outstanding(), 0);
        assertEq(D.getRoute().length, 2);
        assertEq(uint8(D.roleOf(address(rv))), uint8(MemberRole.None));
        assertEq(D.threshold(), 2);
        assertEq(D.opCount(), opId);
        assertEq(D.getOp(opId).confirmations, 1);
        assertFalse(D.getOp(opId).executed);
    }

    /// @dev An Admin is trusted and can change the route at any time, including from inside a leg. The payment
    /// in flight still follows the route it started with, so the settlement cannot be made to revert.
    function test_routeChangedByAMemberVaultMidRoutingDoesNotBlockSettlement() public {
        ReentrantVault rv = new ReentrantVault(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(rv), true);
        Leg[] memory legs = new Leg[](2);
        legs[0] = Leg({kind: LegKind.Vault, target: address(rv), bps: 5_000});
        legs[1] = Leg({kind: LegKind.Transfer, target: tax, bps: 5_000});
        _setRoute(legs);
        vm.prank(d);
        D.setMember(address(rv), MemberRole.Admin);
        rv.addAttack(address(D), abi.encodeCall(CanvasAccount.setRoute, (new Leg[](0))));

        uint256 id = _escrowedInvoice();
        vm.warp(_invoice(id).dueDate);
        vm.prank(stranger);
        invoices.payInvoice(id);

        assertEq(rv.successes(), 1, "the member vault did change the route");
        assertEq(D.getRoute().length, 0);
        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(rv.balanceOf(address(D)), FACE / 2);
        assertEq(usdc.balanceOf(tax), FACE / 2, "the second leg of the original route still ran");
    }

    // ---- Members and policy

    function test_initializeSetsFirstAdmin() public view {
        assertEq(uint8(D.roleOf(d)), uint8(MemberRole.Admin));
        assertEq(D.adminCount(), 1);
        assertEq(D.threshold(), 1);
    }

    function test_lastAdminCannotBeRemoved() public {
        vm.startPrank(d);
        vm.expectRevert(CanvasAccount.LastAdmin.selector);
        D.setMember(d, MemberRole.None);
        vm.expectRevert(CanvasAccount.LastAdmin.selector);
        D.setMember(d, MemberRole.Approver);

        D.setMember(stranger, MemberRole.Admin);
        D.setMember(d, MemberRole.None);
        vm.stopPrank();
        assertEq(D.adminCount(), 1);
    }

    function test_setMemberOnlyAdmin() public {
        vm.expectRevert(CanvasAccount.NotAdmin.selector);
        vm.prank(c2);
        C.setMember(stranger, MemberRole.Admin);
    }

    function test_setPolicyBounds() public {
        vm.startPrank(c1);
        vm.expectRevert(CanvasAccount.InvalidThreshold.selector);
        C.setPolicy(0, 0);
        vm.expectRevert(CanvasAccount.InvalidThreshold.selector);
        C.setPolicy(4, 0);
        C.setPolicy(3, 0);
        vm.stopPrank();
        assertEq(C.threshold(), 3);
    }

    function test_removingApproverBelowThresholdReverts() public {
        vm.startPrank(c1);
        C.setPolicy(3, 0);
        vm.expectRevert(CanvasAccount.InvalidThreshold.selector);
        C.setMember(c3, MemberRole.Viewer);
        vm.stopPrank();
    }

    function test_policyChangeInvalidatesPendingOp() public {
        usdc.mint(address(C), 100e6);
        vm.prank(c1);
        uint256 opId = C.submit(_withdrawCall(stranger, 100e6));
        vm.prank(c1);
        C.setPolicy(2, 1e6);
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.OpStale.selector, opId));
        vm.prank(c2);
        C.confirm(opId);
    }

    // ---- Gated operations

    function test_personalAccountBehavesLikeAWallet() public {
        usdc.mint(address(D), 100e6);
        vm.prank(d);
        D.submit(_withdrawCall(stranger, 100e6));
        assertEq(usdc.balanceOf(stranger), 100e6);
    }

    function test_amountAtOrBelowLimitNeedsOneConfirmation() public {
        usdc.mint(address(C), 300e6);
        vm.prank(c1);
        C.setPolicy(2, 100e6);

        vm.prank(c3);
        C.submit(_withdrawCall(stranger, 100e6));
        assertEq(usdc.balanceOf(stranger), 100e6, "at the limit: one confirmation");

        vm.prank(c3);
        uint256 opId = C.submit(_withdrawCall(stranger, 100e6 + 1));
        assertEq(usdc.balanceOf(stranger), 100e6, "above the limit: waits for the threshold");
        vm.prank(c2);
        C.confirm(opId);
        assertEq(usdc.balanceOf(stranger), 200e6 + 1);
    }

    function test_submitEventCarriesTheCall() public {
        bytes memory data = _withdrawCall(stranger, 100e6);
        vm.expectEmit(address(C));
        emit OpSubmitted(1, CanvasAccount.withdraw.selector, 100e6, c1, data);
        vm.prank(c1);
        C.submit(data);
    }

    function test_submitRejectsOtherSelectorsAndMalformedCalls() public {
        vm.startPrank(d);
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        D.submit(abi.encodeCall(CanvasAccount.setMember, (stranger, MemberRole.Admin)));
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        D.submit(abi.encodeCall(CanvasAccount.setRoute, (new Leg[](0))));
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        D.submit(hex"aabb");
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        D.submit(bytes.concat(_withdrawCall(stranger, 1), hex"00"));
        vm.expectRevert(CanvasAccount.OpNotAllowed.selector);
        D.submit(abi.encodeWithSelector(CanvasAccount.withdraw.selector, stranger));
        vm.stopPrank();
    }

    function test_submitAndConfirmNeedApproverRole() public {
        vm.prank(c1);
        C.setMember(stranger, MemberRole.Viewer);
        vm.expectRevert(CanvasAccount.NotApprover.selector);
        vm.prank(stranger);
        C.submit(_withdrawCall(stranger, 1));

        vm.prank(c1);
        uint256 opId = C.submit(_withdrawCall(stranger, 1));
        vm.expectRevert(CanvasAccount.NotApprover.selector);
        vm.prank(stranger);
        C.confirm(opId);
    }

    function test_gatedFunctionsAreSelfOnly() public {
        vm.startPrank(c1);
        vm.expectRevert(CanvasAccount.NotSelf.selector);
        C.withdraw(c1, 1);
        vm.expectRevert(CanvasAccount.NotSelf.selector);
        C.approveInvoice(1, 0);
        vm.expectRevert(CanvasAccount.NotSelf.selector);
        C.escrowInvoice(1);
        vm.expectRevert(CanvasAccount.NotSelf.selector);
        C.payInvoice(1);
        vm.stopPrank();
    }

    function test_executedOpCannotRunAgain() public {
        usdc.mint(address(C), 200e6);
        uint256 opId = _clubExec(_withdrawCall(stranger, 100e6));
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.OpAlreadyExecuted.selector, opId));
        vm.prank(c3);
        C.confirm(opId);
        assertEq(usdc.balanceOf(stranger), 100e6);
    }

    function test_unknownOpReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.OpNotFound.selector, 7));
        vm.prank(c1);
        C.confirm(7);
    }

    function test_revokeWithdrawsAConfirmation() public {
        usdc.mint(address(C), 100e6);
        vm.prank(c1);
        uint256 opId = C.submit(_withdrawCall(stranger, 100e6));
        vm.prank(c1);
        C.revoke(opId);
        vm.prank(c2);
        C.confirm(opId);
        assertEq(usdc.balanceOf(stranger), 0, "one live confirmation");

        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.NotConfirmed.selector, opId));
        vm.prank(c3);
        C.revoke(opId);

        vm.prank(c3);
        C.confirm(opId);
        assertEq(usdc.balanceOf(stranger), 100e6);
    }

    function test_failedExecutionRevertsTheConfirmationAndCanBeRetried() public {
        vm.prank(c1);
        uint256 opId = C.submit(_withdrawCall(stranger, 100e6));
        vm.expectRevert();
        vm.prank(c2);
        C.confirm(opId);
        assertFalse(C.hasConfirmed(opId, c2));

        usdc.mint(address(C), 100e6);
        vm.prank(c2);
        C.confirm(opId);
        assertEq(usdc.balanceOf(stranger), 100e6);
    }

    function test_payLeavesNoAllowanceOnInvoiceContract() public {
        uint256 id = _approvedInvoice();
        _clubPay(id);
        assertEq(usdc.allowance(address(C), address(invoices)), 0);
    }

    // ---- Budgets

    function test_budgetRollsToANewPeriod() public {
        uint256 relId = _relateDemo();
        vm.prank(c1);
        C.setBudget(EVENTS_BUDGET, 6_000e6, 0);
        _clubApprove(_issue(relId, FACE), EVENTS_BUDGET);

        vm.warp(vm.getBlockTimestamp() + 30 days);
        _clubApprove(_issue(relId, FACE), EVENTS_BUDGET);
        (uint128 limit, uint128 used, uint64 periodStart, uint64 periodLength) = C.budgets(EVENTS_BUDGET);
        assertEq(limit, 6_000e6);
        assertEq(used, FACE, "usage restarted");
        assertEq(periodStart, 1_700_000_000 + 30 days, "aligned to the first period");
        assertEq(periodLength, 30 days, "default period");
    }

    function test_unknownBudgetReverts() public {
        uint256 id = _issue(_relateDemo(), FACE);
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.approveInvoice, (id, 9)));
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.BudgetNotFound.selector, 9));
        vm.prank(c2);
        C.confirm(opId);
    }

    function test_setBudgetRejectsIdZero() public {
        vm.expectRevert(CanvasAccount.InvalidBudget.selector);
        vm.prank(c1);
        C.setBudget(0, 1, 0);
    }

    // ---- Route

    function test_setRouteValidation() public {
        Leg[] memory legs = new Leg[](2);
        legs[0] = Leg({kind: LegKind.Transfer, target: tax, bps: 1_000});
        legs[1] = Leg({kind: LegKind.Hold, target: address(0), bps: 8_999});
        vm.startPrank(d);
        vm.expectRevert(CanvasAccount.InvalidRoute.selector);
        D.setRoute(legs);

        legs[1].bps = 9_000;
        legs[0].target = address(0);
        vm.expectRevert(CanvasAccount.InvalidRoute.selector);
        D.setRoute(legs);

        legs[0] = Leg({kind: LegKind.Vault, target: tax, bps: 1_000});
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.VaultNotAllowed.selector, tax));
        D.setRoute(legs);

        Leg[] memory nine = new Leg[](9);
        for (uint256 i; i < 9; ++i) {
            nine[i] = Leg({kind: LegKind.Hold, target: address(0), bps: i == 0 ? 2_000 : 1_000});
        }
        vm.expectRevert(CanvasAccount.InvalidRoute.selector);
        D.setRoute(nine);
        vm.stopPrank();

        vm.expectRevert(CanvasAccount.NotAdmin.selector);
        vm.prank(stranger);
        D.setRoute(new Leg[](0));
    }

    function test_emptyRouteHoldsEverything() public {
        uint256[] memory legAmounts = new uint256[](1);
        legAmounts[0] = 1_000e6;
        usdc.mint(address(D), 1_000e6);
        vm.expectEmit(address(D));
        emit PaymentRouted(1, 1_000e6, legAmounts);
        vm.prank(address(invoices));
        D.receivePayment(1, 1_000e6);
        assertEq(usdc.balanceOf(address(D)), 1_000e6);
    }

    function test_vaultLegDepositsForTheAccount() public {
        Leg[] memory legs = new Leg[](2);
        legs[0] = Leg({kind: LegKind.Vault, target: address(vault), bps: 2_500});
        legs[1] = Leg({kind: LegKind.Hold, target: address(0), bps: 7_500});
        _setRoute(legs);
        _receive(D, 1, 1_000e6);
        assertEq(vault.maxWithdraw(address(D)), 250e6);
        assertEq(usdc.balanceOf(address(D)), 750e6);
    }

    function test_delistedVaultLegFallsBackToHold() public {
        Leg[] memory legs = new Leg[](1);
        legs[0] = Leg({kind: LegKind.Vault, target: address(vault), bps: 10_000});
        _setRoute(legs);
        vm.prank(owner);
        factory.setAllowedVault(address(vault), false);

        usdc.mint(address(D), 1_000e6);
        vm.expectEmit(address(D));
        emit LegFailed(1, 0, 1_000e6);
        vm.prank(address(invoices));
        D.receivePayment(1, 1_000e6);
        assertEq(usdc.balanceOf(address(D)), 1_000e6);
    }

    /// @dev INV-03. Every leg but the last gets its floor share and the last gets the remainder.
    function testFuzz_routeSplitsExactly(uint256 amount, uint256 seed, uint8 legCount) public {
        amount = bound(amount, 0, 1e15);
        legCount = uint8(bound(legCount, 1, 8));
        Leg[] memory legs = new Leg[](legCount);
        address[] memory targets = new address[](legCount);
        uint256 left = 10_000;
        for (uint256 i; i < legCount; ++i) {
            seed = uint256(keccak256(abi.encode(seed)));
            uint256 bps = i == legCount - 1 ? left : seed % (left + 1);
            left -= bps;
            targets[i] = address(uint160(0xA000 + i));
            legs[i] = Leg({kind: LegKind.Transfer, target: targets[i], bps: uint16(bps)});
        }
        _setRoute(legs);
        _receive(D, 1, amount);

        uint256 total;
        for (uint256 i; i < legCount; ++i) {
            uint256 got = usdc.balanceOf(targets[i]);
            if (i < legCount - 1) assertEq(got, amount * legs[i].bps / 10_000, "floor share");
            total += got;
        }
        assertEq(total, amount, "legs sum to the amount");
        assertEq(usdc.balanceOf(address(D)), 0, "nothing stranded");
    }

    // ---- Vault actions

    function test_vaultDepositAndRedeem() public {
        usdc.mint(address(D), 1_000e6);
        vm.startPrank(d);
        D.vaultDeposit(address(vault), 400e6);
        assertEq(usdc.balanceOf(address(D)), 600e6);
        D.vaultRedeem(address(vault), vault.balanceOf(address(D)));
        vm.stopPrank();
        assertEq(usdc.balanceOf(address(D)), 1_000e6);
    }

    function test_vaultDepositNeedsAllowedVaultAndAdmin() public {
        vm.expectRevert(abi.encodeWithSelector(CanvasAccount.VaultNotAllowed.selector, tax));
        vm.prank(d);
        D.vaultDeposit(tax, 1);
        vm.expectRevert(CanvasAccount.NotAdmin.selector);
        vm.prank(c2);
        C.vaultDeposit(address(vault), 1);
    }
}
