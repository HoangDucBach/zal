// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CanvasAccount} from "../../src/CanvasAccount.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {RelationshipRegistry} from "../../src/RelationshipRegistry.sol";
import {ZalFactory} from "../../src/ZalFactory.sol";
import {ZalFundingPool} from "../../src/ZalFundingPool.sol";
import {ZalInvoice} from "../../src/ZalInvoice.sol";
import {ZalVault} from "../../src/ZalVault.sol";
import {IZalFactory} from "../../src/interfaces/IZalFactory.sol";
import {IZalInvoice} from "../../src/interfaces/IZalInvoice.sol";
import {Invite, Invoice, Leg, LegKind, MemberRole, Role} from "../../src/lib/ZalTypes.sol";

/// @dev The demo cast on one EVM: designer `D` (one Admin, a plain wallet), club `C` (Admin `c1`, Approvers `c2`
/// and `c3`, threshold 2 for every amount), the funding pool, and LP `lp`.
abstract contract ZalTestBase is Test {
    uint256 internal constant FACE = 5_000e6;
    uint64 internal constant TERM = 30 days;
    uint16 internal constant ADVANCE_RATE_BPS = 8_000;
    /// @dev A test fixture, not a calibration. The demo rate is open question 6.
    uint16 internal constant ANNUAL_FEE_BPS = 1_521;

    MockUSDC internal usdc;
    ZalFactory internal factory;
    RelationshipRegistry internal registry;
    ZalInvoice internal invoices;
    ZalFundingPool internal pool;
    ZalVault internal vault;

    address internal owner = makeAddr("owner");
    address internal keeper = makeAddr("keeper");
    address internal lp = makeAddr("lp");
    address internal tax = makeAddr("tax");
    address internal stranger = makeAddr("stranger");

    address internal d;
    uint256 internal dKey;
    address internal c1 = makeAddr("c1");
    address internal c2 = makeAddr("c2");
    address internal c3 = makeAddr("c3");
    CanvasAccount internal D;
    CanvasAccount internal C;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        _deployStack();
        (d, dKey) = makeAddrAndKey("d");
        D = _newAccount(d);
        C = _newAccount(c1);
        vm.startPrank(c1);
        C.setMember(c2, MemberRole.Approver);
        C.setMember(c3, MemberRole.Approver);
        C.setPolicy(2, 0);
        vm.stopPrank();
    }

    function _deployStack() internal {
        usdc = new MockUSDC();
        factory = new ZalFactory(owner);
        registry = new RelationshipRegistry(IZalFactory(address(factory)));
        invoices = new ZalInvoice(IZalFactory(address(factory)), IERC20(address(usdc)));
        pool = new ZalFundingPool(
            IERC20(address(usdc)), IZalInvoice(address(invoices)), owner, ADVANCE_RATE_BPS, ANNUAL_FEE_BPS
        );
        vault = new ZalVault(IERC20(address(usdc)), owner, keeper);
        vm.startPrank(owner);
        factory.wire(address(usdc), address(registry), address(invoices), address(pool));
        factory.setAllowedVault(address(vault), true);
        vm.stopPrank();
    }

    function _newAccount(address admin) internal returns (CanvasAccount) {
        return CanvasAccount(factory.createAccount(admin, bytes32(0)));
    }

    /// @dev The seller proposes and the buyer accepts.
    function _relate(CanvasAccount buyer, address buyerAdmin, CanvasAccount seller, address sellerAdmin)
        internal
        returns (uint256 relId)
    {
        vm.prank(sellerAdmin);
        relId = seller.proposeRelationship(address(buyer), Role.Seller, 0);
        vm.prank(buyerAdmin);
        buyer.acceptRelationship(relId);
    }

    /// @dev D sells to C.
    function _relateDemo() internal returns (uint256) {
        return _relate(C, c1, D, d);
    }

    function _issue(uint256 relId, uint256 face) internal returns (uint256 id) {
        vm.prank(d);
        id = D.issueInvoice(relId, uint128(face), uint64(vm.getBlockTimestamp()) + TERM, keccak256("invoice.pdf"));
    }

    /// @dev c1 submits and c2 confirms, which reaches the club's threshold of 2.
    function _clubExec(bytes memory data) internal returns (uint256 opId) {
        vm.prank(c1);
        opId = C.submit(data);
        vm.prank(c2);
        C.confirm(opId);
    }

    function _clubApprove(uint256 id, uint256 budgetId) internal {
        _clubExec(abi.encodeCall(CanvasAccount.approveInvoice, (id, budgetId)));
    }

    function _clubEscrow(uint256 id) internal {
        _clubExec(abi.encodeCall(CanvasAccount.escrowInvoice, (id)));
    }

    function _clubPay(uint256 id) internal {
        _clubExec(abi.encodeCall(CanvasAccount.payInvoice, (id)));
    }

    /// @dev An Approved 5,000 invoice from D to C, with C holding the cash to pay it.
    function _approvedInvoice() internal returns (uint256 id) {
        id = _issue(_relateDemo(), FACE);
        _clubApprove(id, 0);
        usdc.mint(address(C), FACE);
    }

    function _lpDeposit(uint256 amount) internal {
        usdc.mint(lp, amount);
        vm.startPrank(lp);
        usdc.approve(address(pool), amount);
        pool.deposit(amount, lp);
        vm.stopPrank();
    }

    /// @dev An Approved 5,000 invoice from D to C with the full face value in escrow.
    function _escrowedInvoice() internal returns (uint256 id) {
        id = _approvedInvoice();
        _clubEscrow(id);
    }

    /// @dev The pool owner underwrites `buyer` for unescrowed advances up to `limit` of open principal.
    function _enrol(address buyer, uint256 limit) internal {
        vm.prank(owner);
        pool.setObligorLimit(buyer, limit);
    }

    function _advance(uint256 id) internal {
        vm.prank(d);
        D.requestAdvance(id);
    }

    function _setRoute(Leg[] memory legs) internal {
        vm.prank(d);
        D.setRoute(legs);
    }

    /// @dev 10% to the tax address, 90% Hold.
    function _setTaxRoute() internal {
        Leg[] memory legs = new Leg[](2);
        legs[0] = Leg({kind: LegKind.Transfer, target: tax, bps: 1_000});
        legs[1] = Leg({kind: LegKind.Hold, target: address(0), bps: 9_000});
        _setRoute(legs);
    }

    function _signInvite(uint256 key, Invite memory invite) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, registry.hashInvite(invite));
        return abi.encodePacked(r, s, v);
    }

    function _invoice(uint256 id) internal view returns (Invoice memory) {
        return invoices.getInvoice(id);
    }
}
