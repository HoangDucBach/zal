// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {ZUSDC} from "../src/ZUSDC.sol";
import {RelationshipRegistry} from "../src/RelationshipRegistry.sol";
import {ZalFundingPool} from "../src/ZalFundingPool.sol";
import {ZalInvoice} from "../src/ZalInvoice.sol";
import {ZalVault} from "../src/ZalVault.sol";
import {Advance, Invoice, InvoiceStatus, Leg, LegKind, MemberRole} from "../src/lib/ZalTypes.sol";
import {FlakyVault} from "./support/Mocks.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

/// @dev Random buyer, seller, LP and keeper actions over four accounts that all trade with each other. Account
/// `CLUB` needs two confirmations for every op; the others are single-Admin wallets. Every action is followed by
/// a scan of its logs and of every invoice, which sets a ghost flag when an invariant is broken.
contract ZalHandler is Test {
    struct Wiring {
        ZUSDC usdc;
        RelationshipRegistry registry;
        ZalInvoice invoices;
        ZalFundingPool pool;
        ZalVault vault;
        FlakyVault flaky;
        address keeper;
        address owner;
        address c2;
        address c3;
    }

    uint256 internal constant ACCOUNTS = 4;
    uint256 internal constant CLUB = 2;
    uint256 internal constant BUDGET = 1;

    ZUSDC private immutable usdc;
    RelationshipRegistry private immutable registry;
    ZalInvoice private immutable invoices;
    ZalFundingPool private immutable pool;
    ZalVault private immutable vault;
    FlakyVault private immutable flaky;
    address private immutable keeper;
    address private immutable owner;
    address private immutable c2;
    address private immutable c3;
    address private immutable lp = makeAddr("handler lp");
    address private immutable stranger = makeAddr("handler stranger");

    CanvasAccount[] private accounts;
    address[] private admins;
    address[3] private sinks = [makeAddr("sink a"), makeAddr("sink b"), makeAddr("sink c")];

    /// @dev INV-03.
    bool public ghostRouteSumMismatch;
    /// @dev INV-04.
    bool public ghostTerminalStatusLeft;
    bool public ghostPaidTwice;
    /// @dev INV-05.
    bool public ghostAdvanceSplitMismatch;
    /// @dev INV-06.
    bool public ghostWrongRecipient;
    /// @dev INV-08.
    bool public ghostOpExecutedTwice;
    bool public ghostPoolSharePriceFell;
    /// @dev ZR-FND-07, INV-10. An advance was made with neither full escrow nor room under the buyer's limit, or
    /// was booked against the wrong one of the two.
    bool public ghostUnbackedAdvance;

    /// @dev USDC sent to ZalInvoice outside escrow (INV-07).
    uint256 public ghostDonatedToInvoices;
    uint256 public ghostAdvancedOnEscrow;
    uint256 public ghostAdvancedOnCredit;
    uint256 public ghostIssued;
    uint256 public ghostPaid;
    uint256 public ghostAdvanced;
    uint256 public ghostRepaid;
    uint256 public ghostRouted;
    uint256 public ghostLegFailed;
    uint256 public ghostOpsExecuted;

    mapping(uint256 invoiceId => InvoiceStatus) private lastStatus;
    mapping(uint256 invoiceId => address) private lastOwner;
    mapping(uint256 invoiceId => uint256) private paidEvents;
    mapping(address account => mapping(uint256 opId => uint256)) private executions;
    uint256 private lastSharePrice;

    constructor(Wiring memory w, CanvasAccount[] memory accounts_, address[] memory admins_) {
        usdc = w.usdc;
        registry = w.registry;
        invoices = w.invoices;
        pool = w.pool;
        vault = w.vault;
        flaky = w.flaky;
        keeper = w.keeper;
        owner = w.owner;
        c2 = w.c2;
        c3 = w.c3;
        accounts = accounts_;
        admins = admins_;
        lastSharePrice = w.pool.convertToAssets(1e18);
    }

    modifier tracked() {
        vm.recordLogs();
        _;
        _scanLogs(vm.getRecordedLogs());
        _scanInvoices();
        uint256 price = pool.convertToAssets(1e18);
        if (price < lastSharePrice) ghostPoolSharePriceFell = true;
        lastSharePrice = price;
    }

    // ---- Seller

    function issue(uint256 sellerSeed, uint256 buyerSeed, uint256 face, uint256 term, uint256 approveSeed)
        external
        tracked
    {
        uint256 seller = sellerSeed % ACCOUNTS;
        uint256 buyer = buyerSeed % ACCOUNTS;
        if (seller == buyer) buyer = (buyer + 1) % ACCOUNTS;
        uint256 relId = registry.liveRelationship(address(accounts[buyer]), address(accounts[seller]));
        vm.prank(admins[seller]);
        uint256 id = accounts[seller].issueInvoice(
            relId,
            uint128(bound(face, 1, 1_000_000e6)),
            uint64(block.timestamp + bound(term, 2 hours, 45 days)),
            bytes32(face)
        );
        if (approveSeed % 2 == 0) _exec(buyer, abi.encodeCall(CanvasAccount.approveInvoice, (id, 0)));
    }

    function cancel(uint256 idSeed) external tracked {
        (uint256 id, Invoice memory inv) = _pick(idSeed);
        vm.prank(_adminOf(inv.seller));
        CanvasAccount(inv.seller).cancelInvoice(id);
    }

    function advance(uint256 idSeed) external tracked {
        (uint256 id, Invoice memory inv) = _pick(idSeed);
        vm.prank(_adminOf(inv.seller));
        CanvasAccount(inv.seller).requestAdvance(id);
    }

    /// @dev Some routes are invalid on purpose (nine legs, or bps that do not sum to 10,000). The account must
    /// reject them, or INV-02 fails.
    function setRoute(uint256 accountSeed, uint256 seed, uint256 legCount) external tracked {
        legCount = bound(legCount, 0, 9);
        Leg[] memory legs = new Leg[](legCount);
        uint256 left = 10_000;
        for (uint256 i; i < legCount; ++i) {
            seed = uint256(keccak256(abi.encode(seed)));
            uint256 bps = i == legCount - 1 ? left : seed % (left + 1);
            left -= bps;
            LegKind kind = LegKind(seed >> 16 & 3 == 3 ? 0 : seed >> 16 & 3);
            address target = kind == LegKind.Transfer
                ? sinks[seed >> 32 & 1]
                : (seed >> 32 & 1 == 0 ? address(vault) : address(flaky));
            legs[i] = Leg({kind: kind, target: target, bps: uint16(bps)});
        }
        if (legCount != 0 && seed % 5 == 0) ++legs[0].bps;
        uint256 account = accountSeed % ACCOUNTS;
        vm.prank(admins[account]);
        accounts[account].setRoute(legs);
    }

    // ---- Buyer

    function approve(uint256 idSeed, uint256 budgetSeed) external tracked {
        (uint256 id, Invoice memory inv) = _pick(idSeed);
        _exec(_indexOf(inv.buyer), abi.encodeCall(CanvasAccount.approveInvoice, (id, budgetSeed % 2 == 0 ? BUDGET : 0)));
    }

    function reject(uint256 idSeed) external tracked {
        (uint256 id, Invoice memory inv) = _pick(idSeed);
        vm.prank(_adminOf(inv.buyer));
        CanvasAccount(inv.buyer).rejectInvoice(id);
    }

    function escrow(uint256 idSeed) external tracked {
        (uint256 id, Invoice memory inv) = _pick(idSeed);
        usdc.mint(inv.buyer, inv.faceValue);
        _exec(_indexOf(inv.buyer), abi.encodeCall(CanvasAccount.escrowInvoice, (id)));
    }

    function pay(uint256 idSeed) external tracked {
        (uint256 id, Invoice memory inv) = _pick(idSeed);
        if (inv.escrowed == 0) usdc.mint(inv.buyer, inv.faceValue);
        Advance memory adv = pool.advanceOf(id);
        uint256 poolBefore = usdc.balanceOf(address(pool));
        _exec(_indexOf(inv.buyer), abi.encodeCall(CanvasAccount.payInvoice, (id)));
        // INV-06 in money terms: when the pool held the NFT, the pool is what got paid.
        if (
            adv.seller != address(0) && invoices.getInvoice(id).status == InvoiceStatus.Paid
                && usdc.balanceOf(address(pool)) != poolBefore + adv.principal + adv.fee
        ) ghostWrongRecipient = true;
    }

    function payAsStranger(uint256 idSeed) external tracked {
        (uint256 id,) = _pick(idSeed);
        vm.prank(stranger);
        invoices.payInvoice(id);
    }

    // ---- Club approvals outside the happy path

    /// @dev Leaves the op pending on odd seeds. On even seeds c2 executes it and c3 then tries to run it again,
    /// with enough cash in the account for a second run to succeed if nothing stopped it.
    function clubWithdraw(uint256 amount, uint256 confirmSeed) external tracked {
        amount = bound(amount, 1, 1_000e6);
        usdc.mint(address(accounts[CLUB]), 2 * amount);
        vm.prank(admins[CLUB]);
        uint256 opId = accounts[CLUB].submit(abi.encodeCall(CanvasAccount.withdraw, (sinks[2], amount)));
        if (confirmSeed % 2 != 0) return;
        vm.prank(c2);
        accounts[CLUB].confirm(opId);
        vm.prank(c3);
        try accounts[CLUB].confirm(opId) {} catch {}
    }

    /// @dev Also replays executed and stale ops. The log scan catches a second execution.
    function confirmAny(uint256 accountSeed, uint256 opSeed, uint256 memberSeed) external tracked {
        uint256 account = accountSeed % ACCOUNTS;
        uint256 count = accounts[account].opCount();
        if (count == 0) return;
        vm.prank(_member(account, memberSeed));
        accounts[account].confirm(bound(opSeed, 1, count));
    }

    function revokeAny(uint256 opSeed, uint256 memberSeed) external tracked {
        uint256 count = accounts[CLUB].opCount();
        if (count == 0) return;
        vm.prank(_member(CLUB, memberSeed));
        accounts[CLUB].revoke(bound(opSeed, 1, count));
    }

    function clubChurn(uint256 seed) external tracked {
        vm.prank(admins[CLUB]);
        accounts[CLUB].setMember(c3, seed % 2 == 0 ? MemberRole.None : MemberRole.Approver);
    }

    // ---- Outside the protocol's own paths

    /// @dev Moves the NFT as its current holder, to the pool, a stranger or another account. Only `advance` may
    /// move it, so every one of these must revert.
    function transferNft(uint256 idSeed, uint256 toSeed) external tracked {
        (uint256 id,) = _pick(idSeed);
        address holder = invoices.ownerOf(id);
        address to = [address(pool), stranger, address(accounts[toSeed % ACCOUNTS])][toSeed % 3];
        vm.prank(holder);
        invoices.transferFrom(holder, to, id);
    }

    // ---- Owner, LP, keeper, time

    function setRates(uint256 advanceRateBps, uint256 annualFeeBps) external tracked {
        vm.prank(owner);
        pool.setRates(uint16(bound(advanceRateBps, 1, 10_000)), uint16(bound(annualFeeBps, 0, 30_000)));
    }

    function lpDeposit(uint256 amount) external tracked {
        amount = bound(amount, 1, 2_000_000e6);
        usdc.mint(lp, amount);
        vm.startPrank(lp);
        usdc.approve(address(pool), amount);
        pool.deposit(amount, lp);
        vm.stopPrank();
    }

    function lpWithdraw(uint256 amount) external tracked {
        vm.prank(lp);
        pool.withdraw(bound(amount, 0, pool.maxWithdraw(lp)), lp, lp);
    }

    function lpRedeem(uint256 shares) external tracked {
        vm.prank(lp);
        pool.redeem(bound(shares, 0, pool.maxRedeem(lp)), lp, lp);
    }

    /// @dev Enrols a buyer, changes its limit, or sets it to 0. Limits are small next to the largest face, so
    /// some unescrowed advances fit and others must be refused.
    function enrol(uint256 buyerSeed, uint256 limit) external tracked {
        vm.prank(owner);
        pool.setObligorLimit(address(accounts[buyerSeed % ACCOUNTS]), limit % 3 == 0 ? 0 : bound(limit, 1, 400_000e6));
    }

    /// @dev Anyone can send USDC to ZalInvoice. It must not count as escrow.
    function donateToInvoices(uint256 amount) external tracked {
        amount = bound(amount, 1, 10_000e6);
        usdc.mint(address(invoices), amount);
        ghostDonatedToInvoices += amount;
    }

    function simulateYield(uint256 amount) external tracked {
        amount = bound(amount, 1, 10_000e6);
        usdc.mint(keeper, amount);
        vm.startPrank(keeper);
        usdc.approve(address(vault), amount);
        vault.simulateYield(amount);
        vm.stopPrank();
    }

    function setFlaky(uint256 seed) external tracked {
        flaky.setBroken(seed % 2 == 0);
    }

    function warp(uint256 secs) external tracked {
        vm.warp(block.timestamp + bound(secs, 1 hours, 3 days));
    }

    // ---- Internals

    function _pick(uint256 idSeed) private view returns (uint256 id, Invoice memory inv) {
        id = bound(idSeed, 1, invoices.invoiceCount());
        inv = invoices.getInvoice(id);
    }

    function _indexOf(address account) private view returns (uint256) {
        for (uint256 i; i < ACCOUNTS; ++i) {
            if (address(accounts[i]) == account) return i;
        }
        revert("unknown account");
    }

    function _adminOf(address account) private view returns (address) {
        return admins[_indexOf(account)];
    }

    function _member(uint256 account, uint256 memberSeed) private view returns (address) {
        if (account != CLUB) return admins[account];
        return [admins[CLUB], c2, c3][memberSeed % 3];
    }

    /// @dev A failed submit or confirm is swallowed, so the action's log scan still runs.
    function _exec(uint256 account, bytes memory data) private {
        vm.prank(admins[account]);
        try accounts[account].submit(data) returns (uint256 opId) {
            if (account != CLUB) return;
            vm.prank(c2);
            try accounts[CLUB].confirm(opId) {} catch {}
        } catch {}
    }

    function _scanLogs(Vm.Log[] memory logs) private {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            bytes32 sig = log.topics[0];
            if (sig == CanvasAccount.OpExecuted.selector) {
                ++ghostOpsExecuted;
                if (++executions[log.emitter][uint256(log.topics[1])] > 1) ghostOpExecutedTwice = true;
            } else if (sig == CanvasAccount.PaymentRouted.selector) {
                ++ghostRouted;
                (uint256 amount, uint256[] memory legAmounts) = abi.decode(log.data, (uint256, uint256[]));
                uint256 total;
                for (uint256 j; j < legAmounts.length; ++j) {
                    total += legAmounts[j];
                }
                if (total != amount) ghostRouteSumMismatch = true;
            } else if (sig == CanvasAccount.LegFailed.selector) {
                ++ghostLegFailed;
            } else if (sig == ZalInvoice.InvoiceIssued.selector) {
                ++ghostIssued;
            } else if (sig == ZalInvoice.InvoicePaid.selector) {
                ++ghostPaid;
                uint256 id = uint256(log.topics[1]);
                if (++paidEvents[id] > 1) ghostPaidTwice = true;
                // The owner cannot change inside the action that pays, so the last recorded owner is the
                // owner at the time of payment.
                if (address(uint160(uint256(log.topics[3]))) != lastOwner[id]) ghostWrongRecipient = true;
            } else if (sig == ZalFundingPool.Advanced.selector) {
                ++ghostAdvanced;
                (uint128 principal, uint128 fee, bool onCredit) = abi.decode(log.data, (uint128, uint128, bool));
                Invoice memory inv = invoices.getInvoice(uint256(log.topics[1]));
                if (uint256(principal) + fee > inv.faceValue) ghostAdvanceSplitMismatch = true;
                // Nothing else runs in the action that advances, so this is the state the advance was made in.
                bool escrowed = inv.escrowed == inv.faceValue;
                if (onCredit != pool.advanceOf(uint256(log.topics[1])).onCredit) ghostUnbackedAdvance = true;
                if (onCredit) {
                    ++ghostAdvancedOnCredit;
                    if (escrowed || pool.obligorOutstanding(inv.buyer) > pool.obligorLimit(inv.buyer)) {
                        ghostUnbackedAdvance = true;
                    }
                } else {
                    ++ghostAdvancedOnEscrow;
                    if (!escrowed) ghostUnbackedAdvance = true;
                }
            } else if (sig == ZalFundingPool.Repaid.selector) {
                ++ghostRepaid;
                (uint128 principal, uint128 fee, uint128 reserve) = abi.decode(log.data, (uint128, uint128, uint128));
                if (uint256(principal) + fee + reserve != invoices.getInvoice(uint256(log.topics[1])).faceValue) {
                    ghostAdvanceSplitMismatch = true;
                }
            }
        }
    }

    function _scanInvoices() private {
        uint256 count = invoices.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            InvoiceStatus status = invoices.getInvoice(id).status;
            InvoiceStatus last = lastStatus[id];
            bool wasTerminal =
                last == InvoiceStatus.Paid || last == InvoiceStatus.Rejected || last == InvoiceStatus.Cancelled;
            if (wasTerminal && status != last) ghostTerminalStatusLeft = true;
            lastStatus[id] = status;
            lastOwner[id] = status == InvoiceStatus.Cancelled ? address(0) : invoices.ownerOf(id);
        }
    }
}

contract ZalInvariantTest is ZalTestBase {
    uint256 internal constant ACCOUNTS = 4;

    ZalHandler internal handler;
    CanvasAccount[] internal accounts;
    address[] internal admins;

    function setUp() public override {
        super.setUp();
        FlakyVault flaky = new FlakyVault(address(usdc));
        vm.prank(owner);
        factory.setAllowedVault(address(flaky), true);

        address e = makeAddr("e");
        address f = makeAddr("f");
        accounts = [D, _newAccount(e), C, _newAccount(f)];
        admins = [d, e, c1, f];
        for (uint256 buyer; buyer < ACCOUNTS; ++buyer) {
            vm.prank(admins[buyer]);
            accounts[buyer].setBudget(1, 500_000e6, 7 days);
            for (uint256 seller; seller < ACCOUNTS; ++seller) {
                if (buyer != seller) _relate(accounts[buyer], admins[buyer], accounts[seller], admins[seller]);
            }
        }

        // Starting liquidity, so advances are not starved until the handler's LP happens to deposit.
        _lpDeposit(5_000_000e6);

        handler = new ZalHandler(
            ZalHandler.Wiring({
                usdc: usdc,
                registry: registry,
                invoices: invoices,
                pool: pool,
                vault: vault,
                flaky: flaky,
                keeper: keeper,
                owner: owner,
                c2: c2,
                c3: c3
            }),
            accounts,
            admins
        );
        targetContract(address(handler));
    }

    function invariant_INV01_poolTotalAssetsIsCashPlusOpenPrincipal() public view {
        uint256 openPrincipal;
        uint256 count = invoices.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            Advance memory adv = pool.advanceOf(id);
            openPrincipal += adv.principal;
            bool funded = _invoice(id).status != InvoiceStatus.Cancelled && invoices.ownerOf(id) == address(pool);
            assertEq(adv.seller != address(0), funded && _invoice(id).status == InvoiceStatus.Approved, "advance open");
        }
        assertEq(pool.outstanding(), openPrincipal, "outstanding");
        assertEq(pool.totalAssets(), usdc.balanceOf(address(pool)) + openPrincipal, "INV-01");
    }

    function invariant_INV02_storedRoutesAreValid() public view {
        for (uint256 i; i < ACCOUNTS; ++i) {
            Leg[] memory legs = accounts[i].getRoute();
            assertLe(legs.length, 8, "INV-02 legs");
            if (legs.length == 0) continue;
            uint256 totalBps;
            for (uint256 j; j < legs.length; ++j) {
                totalBps += legs[j].bps;
            }
            assertEq(totalBps, 10_000, "INV-02 bps");
        }
    }

    function invariant_INV03_routedLegsSumToAmount() public view {
        assertFalse(handler.ghostRouteSumMismatch(), "INV-03");
    }

    function invariant_INV04_paidOnceAndTerminalStatesStay() public view {
        assertFalse(handler.ghostPaidTwice(), "INV-04 paid twice");
        assertFalse(handler.ghostTerminalStatusLeft(), "INV-04 terminal");
    }

    function invariant_INV05_advanceSplitsFaceValue() public view {
        assertFalse(handler.ghostAdvanceSplitMismatch(), "INV-05 events");
        uint256 count = invoices.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            Advance memory adv = pool.advanceOf(id);
            assertLe(uint256(adv.principal) + adv.fee, _invoice(id).faceValue, "INV-05 reserve >= 0");
        }
    }

    function invariant_INV06_recipientIsOwnerAtPayment() public view {
        assertFalse(handler.ghostWrongRecipient(), "INV-06");
    }

    function invariant_INV07_totalEscrowedIsOpenEscrowAndIsCovered() public view {
        uint256 escrowed;
        uint256 count = invoices.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            Invoice memory inv = _invoice(id);
            assertTrue(inv.escrowed == 0 || inv.escrowed == inv.faceValue, "escrow is all or nothing");
            if (inv.status != InvoiceStatus.Approved) assertEq(inv.escrowed, 0, "escrow only while Approved");
            if (inv.status != InvoiceStatus.Paid) escrowed += inv.escrowed;
        }
        assertEq(invoices.totalEscrowed(), escrowed, "INV-07 totalEscrowed");
        assertGe(usdc.balanceOf(address(invoices)), escrowed, "INV-07 balance covers the escrow");
        assertEq(
            usdc.balanceOf(address(invoices)), escrowed + handler.ghostDonatedToInvoices(), "escrow plus donations"
        );
    }

    function invariant_INV08_gatedOpExecutesAtMostOnce() public view {
        assertFalse(handler.ghostOpExecutedTwice(), "INV-08");
    }

    function invariant_INV09_nftHeldBySellerOrPoolOrBurned() public {
        uint256 count = invoices.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            Invoice memory inv = _invoice(id);
            if (inv.status == InvoiceStatus.Cancelled) {
                vm.expectRevert();
                invoices.ownerOf(id);
            } else {
                address holder = invoices.ownerOf(id);
                assertTrue(holder == inv.seller || holder == address(pool), "INV-09");
            }
        }
    }

    function invariant_INV10_obligorOutstandingIsOpenCreditPrincipal() public view {
        assertFalse(handler.ghostUnbackedAdvance(), "ZR-FND-07 advance without escrow or limit");
        uint256[] memory onCredit = new uint256[](ACCOUNTS);
        uint256 count = invoices.invoiceCount();
        for (uint256 id = 1; id <= count; ++id) {
            Advance memory adv = pool.advanceOf(id);
            if (!adv.onCredit) continue;
            address buyer = _invoice(id).buyer;
            for (uint256 i; i < ACCOUNTS; ++i) {
                if (address(accounts[i]) == buyer) onCredit[i] += adv.principal;
            }
        }
        for (uint256 i; i < ACCOUNTS; ++i) {
            assertEq(pool.obligorOutstanding(address(accounts[i])), onCredit[i], "INV-10");
        }
    }

    function invariant_poolSharePriceNeverFalls() public view {
        assertFalse(handler.ghostPoolSharePriceFell(), "share price");
    }

    /// @dev Guards the suite itself: a fixed pseudo-random walk over the handler must reach every settled state,
    /// or the invariants above would pass without testing anything.
    function test_handlerReachesSettledStates() public {
        bytes4[22] memory actions = [
            ZalHandler.issue.selector,
            ZalHandler.cancel.selector,
            ZalHandler.advance.selector,
            ZalHandler.setRoute.selector,
            ZalHandler.approve.selector,
            ZalHandler.reject.selector,
            ZalHandler.escrow.selector,
            ZalHandler.pay.selector,
            ZalHandler.payAsStranger.selector,
            ZalHandler.clubWithdraw.selector,
            ZalHandler.transferNft.selector,
            ZalHandler.setRates.selector,
            ZalHandler.enrol.selector,
            ZalHandler.donateToInvoices.selector,
            ZalHandler.confirmAny.selector,
            ZalHandler.revokeAny.selector,
            ZalHandler.clubChurn.selector,
            ZalHandler.lpDeposit.selector,
            ZalHandler.lpWithdraw.selector,
            ZalHandler.simulateYield.selector,
            ZalHandler.setFlaky.selector,
            ZalHandler.warp.selector
        ];
        // Every handler action takes only uint256 seeds, so one argument encoding fits them all.
        for (uint256 i; i < 1500; ++i) {
            bytes memory args = abi.encode(_word(i, 1), _word(i, 2), _word(i, 3), _word(i, 4), _word(i, 5));
            (bool ok,) = address(handler).call(bytes.concat(actions[_word(i, 0) % actions.length], args));
            ok;
        }
        invariant_INV01_poolTotalAssetsIsCashPlusOpenPrincipal();
        invariant_INV02_storedRoutesAreValid();
        invariant_INV03_routedLegsSumToAmount();
        invariant_INV04_paidOnceAndTerminalStatesStay();
        invariant_INV05_advanceSplitsFaceValue();
        invariant_INV06_recipientIsOwnerAtPayment();
        invariant_INV07_totalEscrowedIsOpenEscrowAndIsCovered();
        invariant_INV08_gatedOpExecutesAtMostOnce();
        invariant_INV09_nftHeldBySellerOrPoolOrBurned();
        invariant_INV10_obligorOutstandingIsOpenCreditPrincipal();
        invariant_poolSharePriceNeverFalls();

        assertGt(handler.ghostIssued(), 0, "issued");
        assertGt(handler.ghostOpsExecuted(), 0, "ops executed");
        assertGt(handler.ghostAdvanced(), 0, "advanced");
        assertGt(handler.ghostAdvancedOnEscrow(), 0, "advanced against escrow");
        assertGt(handler.ghostAdvancedOnCredit(), 0, "advanced on an obligor limit");
        assertGt(handler.ghostDonatedToInvoices(), 0, "donated to the invoice contract");
        assertGt(handler.ghostPaid(), 0, "paid");
        assertGt(handler.ghostRepaid(), 0, "repaid through the pool");
        assertGt(handler.ghostRouted(), 0, "routed");
        assertGt(handler.ghostLegFailed(), 0, "a leg failed and fell back");
        emit log_named_uint("issued", handler.ghostIssued());
        emit log_named_uint("ops executed", handler.ghostOpsExecuted());
        emit log_named_uint("advanced", handler.ghostAdvanced());
        emit log_named_uint("advanced on escrow", handler.ghostAdvancedOnEscrow());
        emit log_named_uint("advanced on credit", handler.ghostAdvancedOnCredit());
        emit log_named_uint("paid", handler.ghostPaid());
        emit log_named_uint("repaid", handler.ghostRepaid());
        emit log_named_uint("routed", handler.ghostRouted());
        emit log_named_uint("leg failed", handler.ghostLegFailed());
    }

    function _word(uint256 step, uint256 index) private pure returns (uint256) {
        return uint256(keccak256(abi.encode("walk", step, index)));
    }
}
