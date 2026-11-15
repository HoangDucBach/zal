// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {ZalFundingPool} from "../src/ZalFundingPool.sol";
import {Advance, InvoiceStatus, Role} from "../src/lib/ZalTypes.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

contract ZalFundingPoolTest is ZalTestBase {
    uint256 internal constant PRINCIPAL = 4_000e6;

    event ObligorLimitSet(address indexed buyer, uint256 limit);

    function _expectedFee(uint256 principal, uint256 annualFeeBps, uint256 term) internal pure returns (uint256) {
        uint256 denominator = 10_000 * 365 days;
        return (principal * annualFeeBps * term + denominator - 1) / denominator;
    }

    function _fundedInvoice() internal returns (uint256 id) {
        id = _escrowedInvoice();
        _lpDeposit(10_000e6);
        _advance(id);
    }

    // ---- Acceptance tests

    function test_AT08_advanceAgainstApprovedInvoice() public {
        uint256 id = _escrowedInvoice();
        _lpDeposit(10_000e6);
        _advance(id);

        assertEq(usdc.balanceOf(address(D)), PRINCIPAL, "D receives 80% of face");
        assertEq(invoices.ownerOf(id), address(pool), "pool owns the NFT");
        Advance memory adv = pool.advanceOf(id);
        assertEq(adv.seller, address(D));
        assertEq(adv.principal, PRINCIPAL);
        assertEq(adv.fee, _expectedFee(PRINCIPAL, ANNUAL_FEE_BPS, 30 days), "fee matches the formula");
        assertEq(adv.fee, 50_005_480, "4,000 x 15.21% x 30/365, rounded up to the next micro-dollar");
        assertEq(pool.outstanding(), PRINCIPAL);
        assertEq(pool.totalAssets(), 10_000e6, "lending does not change total assets");
    }

    function test_AT09_payFundedInvoiceSplitsPoolAndSellerRoute() public {
        _setTaxRoute();
        uint256 id = _fundedInvoice();
        uint256 fee = pool.advanceOf(id).fee;
        uint256 reserve = FACE - PRINCIPAL - fee;
        uint256 poolBefore = usdc.balanceOf(address(pool));

        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.prank(c2);
        C.confirm(opId);

        assertEq(usdc.balanceOf(address(pool)), poolBefore + PRINCIPAL + fee, "pool keeps principal and fee");
        assertEq(usdc.balanceOf(tax), reserve / 10, "10% of the reserve to tax");
        assertEq(usdc.balanceOf(address(D)), PRINCIPAL + reserve - reserve / 10, "advance plus 90% of the reserve");
        assertEq(usdc.balanceOf(address(C)), 0);
        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(pool.outstanding(), 0);
        assertEq(pool.advanceOf(id).seller, address(0), "advance closed");
        assertEq(pool.totalAssets(), 10_000e6 + fee, "the fee is LP income");
    }

    function test_AT17_selfDealingPairCannotTakeAnUnescrowedAdvance() public {
        _lpDeposit(10_000e6);
        address attacker = makeAddr("attacker");

        vm.startPrank(attacker);
        CanvasAccount buyer = CanvasAccount(factory.createAccount(attacker, bytes32(uint256(1))));
        CanvasAccount seller = CanvasAccount(factory.createAccount(attacker, bytes32(uint256(2))));
        uint256 relId = seller.proposeRelationship(address(buyer), Role.Seller, 0);
        buyer.acceptRelationship(relId);
        // A 12,500 face asks for a 10,000 principal, which is all the pool holds.
        uint256 id = seller.issueInvoice(relId, 12_500e6, uint64(block.timestamp + 1 days), bytes32(0));
        buyer.submit(abi.encodeCall(CanvasAccount.approveInvoice, (id, 0)));

        vm.expectRevert(
            abi.encodeWithSelector(ZalFundingPool.ObligorLimitExceeded.selector, address(buyer), 10_000e6, 0)
        );
        seller.requestAdvance(id);
        vm.stopPrank();

        assertEq(usdc.balanceOf(address(pool)), 10_000e6, "pool cash untouched");
        assertEq(usdc.balanceOf(address(seller)), 0);
        assertEq(invoices.ownerOf(id), address(seller), "the NFT did not move");
        assertEq(pool.outstanding(), 0);
        assertEq(pool.maxWithdraw(lp), 10_000e6, "the LP can still leave whole");
    }

    function test_AT18_enrolledBuyerIsFundedUpToItsLimit() public {
        _lpDeposit(20_000e6);
        _enrol(address(C), 6_000e6);
        uint256 relId = _relateDemo();
        uint256 first = _issue(relId, FACE);
        uint256 second = _issue(relId, FACE);
        uint256 third = _issue(relId, FACE);
        _clubApprove(first, 0);
        _clubApprove(second, 0);
        _clubApprove(third, 0);

        _advance(first);
        assertEq(usdc.balanceOf(address(D)), PRINCIPAL, "first advance paid out with nothing escrowed");
        assertTrue(pool.advanceOf(first).onCredit);
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL);

        vm.expectRevert(
            abi.encodeWithSelector(ZalFundingPool.ObligorLimitExceeded.selector, address(C), 2 * PRINCIPAL, 6_000e6)
        );
        vm.prank(d);
        D.requestAdvance(second);
        assertEq(invoices.ownerOf(second), address(D));
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL, "a refused advance uses no limit");

        usdc.mint(address(C), FACE);
        _clubPay(first);
        assertEq(pool.obligorOutstanding(address(C)), 0, "repayment frees the limit");

        _advance(third);
        assertEq(invoices.ownerOf(third), address(pool), "a new advance fits again");
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL);
        assertEq(pool.outstanding(), PRINCIPAL);
    }

    function test_AT14_withdrawalsCappedByIdleCash() public {
        _fundedInvoice();
        uint256 idle = 10_000e6 - PRINCIPAL;
        assertEq(pool.maxWithdraw(lp), idle);

        vm.startPrank(lp);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, lp, idle + 1, idle));
        pool.withdraw(idle + 1, lp, lp);
        uint256 shares = pool.balanceOf(lp);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxRedeem.selector, lp, shares, pool.maxRedeem(lp))
        );
        pool.redeem(shares, lp, lp);

        pool.withdraw(idle, lp, lp);
        vm.stopPrank();
        assertEq(usdc.balanceOf(lp), idle);
        assertEq(pool.maxWithdraw(lp), 0);
    }

    function test_maxWithdrawIsExactlyIdleCashAtAnUnevenSharePrice() public {
        _lpDeposit(9_999_999_999);
        _enrol(address(C), 2 * 3_333_333_333);
        uint256 relId = _relateDemo();
        for (uint256 i; i < 2; ++i) {
            uint256 id = _issue(relId, 3_333_333_333);
            _clubApprove(id, 0);
            _advance(id);
            if (i == 0) {
                usdc.mint(address(C), 3_333_333_333);
                _clubPay(id);
            }
        }
        uint256 idle = pool.idleCash();
        assertGt(pool.outstanding(), 0);
        assertEq(pool.maxWithdraw(lp), idle);
        vm.prank(lp);
        pool.withdraw(idle, lp, lp);
        assertEq(pool.idleCash(), 0);
    }

    // ---- Advance checks

    function test_advanceOnlyBySeller() public {
        uint256 id = _approvedInvoice();
        _lpDeposit(10_000e6);
        vm.expectRevert(ZalFundingPool.NotSeller.selector);
        vm.prank(stranger);
        pool.advance(id);
        vm.expectRevert(CanvasAccount.NotAdmin.selector);
        vm.prank(stranger);
        D.requestAdvance(id);
    }

    function test_advanceNeedsApprovedInvoice() public {
        uint256 id = _issue(_relateDemo(), FACE);
        _lpDeposit(10_000e6);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.NotApproved.selector, id));
        vm.prank(d);
        D.requestAdvance(id);
    }

    function test_advanceOnlyOnce() public {
        uint256 id = _fundedInvoice();
        vm.expectRevert();
        vm.prank(d);
        D.requestAdvance(id);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.AlreadyFunded.selector, id));
        vm.prank(address(D));
        pool.advance(id);
    }

    function test_advanceNeedsFutureDueDate() public {
        uint256 id = _approvedInvoice();
        _lpDeposit(10_000e6);
        vm.warp(_invoice(id).dueDate);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.PastDue.selector, id));
        vm.prank(d);
        D.requestAdvance(id);
    }

    function test_advanceAtExactlyTheLimitFitsAndOneUnitLessDoesNot() public {
        uint256 id = _approvedInvoice();
        _lpDeposit(10_000e6);
        _enrol(address(C), PRINCIPAL - 1);
        vm.expectRevert(
            abi.encodeWithSelector(ZalFundingPool.ObligorLimitExceeded.selector, address(C), PRINCIPAL, PRINCIPAL - 1)
        );
        vm.prank(d);
        D.requestAdvance(id);

        _enrol(address(C), PRINCIPAL);
        _advance(id);
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL);
    }

    function test_escrowedAdvanceUsesNoObligorLimit() public {
        _enrol(address(C), PRINCIPAL);
        uint256 relId = _relateDemo();
        uint256 escrowed = _issue(relId, FACE);
        uint256 unescrowed = _issue(relId, FACE);
        _clubApprove(escrowed, 0);
        _clubApprove(unescrowed, 0);
        usdc.mint(address(C), FACE);
        _clubEscrow(escrowed);
        _lpDeposit(10_000e6);

        _advance(escrowed);
        assertFalse(pool.advanceOf(escrowed).onCredit);
        assertEq(pool.obligorOutstanding(address(C)), 0);

        _advance(unescrowed);
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL, "the whole limit was still free");
        _clubPay(escrowed);
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL, "repaying the escrowed advance frees no limit");
    }

    function test_loweredLimitBlocksNewAdvancesButNotRepayment() public {
        _lpDeposit(10_000e6);
        _enrol(address(C), 2 * PRINCIPAL);
        uint256 relId = _relateDemo();
        uint256 first = _issue(relId, FACE);
        uint256 second = _issue(relId, FACE);
        _clubApprove(first, 0);
        _clubApprove(second, 0);
        _advance(first);

        _enrol(address(C), 0);
        vm.expectRevert(
            abi.encodeWithSelector(ZalFundingPool.ObligorLimitExceeded.selector, address(C), 2 * PRINCIPAL, 0)
        );
        vm.prank(d);
        D.requestAdvance(second);

        // The buyer escrows after the advance was made on its limit. Settlement still frees that limit.
        usdc.mint(address(C), FACE);
        _clubEscrow(first);
        assertEq(pool.obligorOutstanding(address(C)), PRINCIPAL, "escrow after funding does not free the limit");
        vm.warp(_invoice(first).dueDate);
        vm.prank(stranger);
        invoices.payInvoice(first);
        assertEq(pool.obligorOutstanding(address(C)), 0);
        assertEq(pool.outstanding(), 0);
    }

    function test_advancedEventSaysWhetherTheCreditLineWasUsed() public {
        _lpDeposit(20_000e6);
        _enrol(address(C), 6_000e6);
        uint256 relId = _relateDemo();
        uint256 escrowed = _issue(relId, FACE);
        uint256 onCredit = _issue(relId, FACE);
        _clubApprove(escrowed, 0);
        _clubApprove(onCredit, 0);
        usdc.mint(address(C), FACE);
        _clubEscrow(escrowed);
        (, uint256 quotedFee) = pool.quote(FACE, invoices.getInvoice(escrowed).dueDate);

        vm.expectEmit(address(pool));
        emit ZalFundingPool.Advanced(escrowed, address(D), uint128(PRINCIPAL), uint128(quotedFee), false);
        _advance(escrowed);

        (, quotedFee) = pool.quote(FACE, invoices.getInvoice(onCredit).dueDate);
        vm.expectEmit(address(pool));
        emit ZalFundingPool.Advanced(onCredit, address(D), uint128(PRINCIPAL), uint128(quotedFee), true);
        _advance(onCredit);
    }

    function test_setObligorLimitOnlyOwnerAndEmits() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        pool.setObligorLimit(address(C), 6_000e6);

        vm.expectEmit(address(pool));
        emit ObligorLimitSet(address(C), 6_000e6);
        _enrol(address(C), 6_000e6);
        assertEq(pool.obligorLimit(address(C)), 6_000e6);
    }

    function test_advanceNeedsIdleCash() public {
        uint256 id = _escrowedInvoice();
        _lpDeposit(PRINCIPAL - 1);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.InsufficientIdleCash.selector, PRINCIPAL, PRINCIPAL - 1));
        vm.prank(d);
        D.requestAdvance(id);
    }

    function test_advanceRevertsWhenFeeWouldEatTheReserve() public {
        uint256 id = _approvedInvoice();
        _lpDeposit(10_000e6);
        vm.prank(owner);
        pool.setRates(10_000, 1);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.FeeExceedsReserve.selector, FACE, 41_096, FACE));
        vm.prank(d);
        D.requestAdvance(id);
    }

    function test_paidInvoiceCannotBeFunded() public {
        uint256 id = _approvedInvoice();
        _lpDeposit(10_000e6);
        _clubPay(id);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.NotApproved.selector, id));
        vm.prank(d);
        D.requestAdvance(id);
    }

    // ---- Repayment

    function test_onRepaidOnlyFromInvoiceContract() public {
        uint256 id = _fundedInvoice();
        vm.expectRevert(ZalFundingPool.NotInvoiceContract.selector);
        vm.prank(stranger);
        pool.onRepaid(id, FACE);
    }

    function test_onRepaidNeedsOpenAdvanceAndFaceValue() public {
        uint256 id = _fundedInvoice();
        vm.startPrank(address(invoices));
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.NoAdvance.selector, 99));
        pool.onRepaid(99, FACE);
        vm.expectRevert(abi.encodeWithSelector(ZalFundingPool.WrongRepayment.selector, FACE - 1, FACE));
        pool.onRepaid(id, FACE - 1);
        vm.stopPrank();
    }

    function test_strangerSettlesEscrowedFundedInvoiceAfterDueDate() public {
        uint256 id = _approvedInvoice();
        _clubEscrow(id);
        _lpDeposit(10_000e6);
        _advance(id);
        uint256 fee = pool.advanceOf(id).fee;

        vm.warp(_invoice(id).dueDate);
        vm.prank(stranger);
        invoices.payInvoice(id);
        assertEq(usdc.balanceOf(address(pool)), 10_000e6 + fee);
        assertEq(usdc.balanceOf(address(D)), FACE - fee);
        assertEq(usdc.balanceOf(address(invoices)), 0);
    }

    function test_lpExitsWithTheFeeAfterRepayment() public {
        uint256 id = _fundedInvoice();
        uint256 fee = pool.advanceOf(id).fee;
        _clubPay(id);

        uint256 shares = pool.balanceOf(lp);
        vm.prank(lp);
        uint256 assets = pool.redeem(shares, lp, lp);
        assertApproxEqAbs(assets, 10_000e6 + fee, 1, "principal back plus the fee");
        assertLe(assets, 10_000e6 + fee);
    }

    function test_feeFixedAtAdvanceTimeEvenIfRatesChange() public {
        uint256 id = _fundedInvoice();
        uint256 fee = pool.advanceOf(id).fee;
        vm.prank(owner);
        pool.setRates(5_000, 9_000);
        _clubPay(id);
        assertEq(usdc.balanceOf(address(pool)), 10_000e6 + fee);
    }

    // ---- Parameters and shares

    function test_setRatesOnlyOwnerAndBounded() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        pool.setRates(8_000, 100);
        vm.startPrank(owner);
        vm.expectRevert(ZalFundingPool.InvalidAdvanceRate.selector);
        pool.setRates(10_001, 100);
        vm.expectRevert(ZalFundingPool.InvalidAdvanceRate.selector);
        pool.setRates(0, 100);
        vm.stopPrank();
    }

    function test_sharesUseSixDecimalOffset() public view {
        assertEq(pool.decimals(), 12);
        assertEq(IERC4626(address(pool)).asset(), address(usdc));
    }

    /// @dev ZR-FND-06. A first depositor who donates to inflate the share price cannot take the next deposit.
    function testFuzz_donationDoesNotStealFromNextDepositor(uint256 donation, uint256 victimDeposit) public {
        donation = bound(donation, 1, 1e15);
        victimDeposit = bound(victimDeposit, 1e6, 1e15);
        address attacker = makeAddr("attacker");
        usdc.mint(attacker, donation + 1);
        vm.startPrank(attacker);
        usdc.approve(address(pool), 1);
        pool.deposit(1, attacker);
        usdc.transfer(address(pool), donation);
        vm.stopPrank();

        _lpDeposit(victimDeposit);
        uint256 lpShares = pool.balanceOf(lp);
        uint256 attackerShares = pool.balanceOf(attacker);
        vm.prank(lp);
        uint256 victimOut = pool.redeem(lpShares, lp, lp);
        vm.prank(attacker);
        uint256 attackerOut = pool.redeem(attackerShares, attacker, attacker);

        assertLe(attackerOut, donation + 1, "the attacker never profits");
        uint256 victimLoss = victimDeposit - victimOut;
        assertLe(victimLoss, donation / 1e6 + 1, "the victim loses at most a millionth of the donation");
        assertGe(donation + 2 - attackerOut, victimLoss, "beyond one unit of dust, the attack costs more than it takes");
    }

    /// @dev ZR-FND-02, ZR-FND-03, INV-05. Principal rounds down, the fee rounds up and is never undercharged,
    /// and a funded invoice always splits into principal + fee + reserve == face. Even faces are funded
    /// against escrow and odd faces on the buyer's limit, so both routes of ZR-FND-07 see the same math.
    function testFuzz_advanceMath(uint128 face, uint16 advanceRateBps, uint16 annualFeeBps, uint64 term) public {
        face = uint128(bound(face, 1, 1e15));
        advanceRateBps = uint16(bound(advanceRateBps, 1, 10_000));
        annualFeeBps = uint16(bound(annualFeeBps, 0, 20_000));
        term = uint64(bound(term, 1, 5 * 365 days));
        vm.prank(owner);
        pool.setRates(advanceRateBps, annualFeeBps);

        (uint256 principal, uint256 fee) = pool.quote(face, block.timestamp + term);
        assertEq(principal, uint256(face) * advanceRateBps / 10_000, "principal rounds down");
        uint256 numerator = principal * annualFeeBps * term;
        uint256 denominator = 10_000 * 365 days;
        assertGe(fee * denominator, numerator, "fee is never below the exact value");
        assertLt(fee * denominator, numerator + denominator, "and less than one unit above it");

        uint256 relId = _relateDemo();
        vm.prank(d);
        uint256 id = D.issueInvoice(relId, face, uint64(block.timestamp) + term, bytes32(0));
        _clubApprove(id, 0);
        usdc.mint(address(C), face);
        _lpDeposit(face);
        bool onCredit = face % 2 == 1;
        if (onCredit) _enrol(address(C), principal);
        else _clubEscrow(id);

        if (principal == 0 || principal + fee > face) {
            vm.expectRevert();
            vm.prank(d);
            D.requestAdvance(id);
            return;
        }
        _advance(id);
        assertEq(pool.totalAssets(), face, "INV-01 after the advance");
        assertEq(pool.obligorOutstanding(address(C)), onCredit ? principal : 0, "INV-10 after the advance");
        uint256 dBefore = usdc.balanceOf(address(D));
        _clubPay(id);

        uint256 reserve = face - principal - fee;
        assertEq(usdc.balanceOf(address(D)) - dBefore, reserve, "seller gets exactly the reserve");
        assertEq(usdc.balanceOf(address(pool)), uint256(face) + fee, "pool is whole plus the fee");
        assertEq(pool.outstanding(), 0);
        assertEq(pool.obligorOutstanding(address(C)), 0, "INV-10 after repayment");
    }
}
