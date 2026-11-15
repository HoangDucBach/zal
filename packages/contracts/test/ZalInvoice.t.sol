// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {CanvasAccount} from "../src/CanvasAccount.sol";
import {ZalInvoice} from "../src/ZalInvoice.sol";
import {Invoice, InvoiceStatus, Role} from "../src/lib/ZalTypes.sol";
import {ZalTestBase} from "./support/ZalTestBase.sol";

contract ZalInvoiceTest is ZalTestBase {
    event InvoicePaid(uint256 indexed id, address indexed payer, address indexed recipient, uint128 faceValue);

    function _wrongStatus(uint256 id, InvoiceStatus status) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(ZalInvoice.WrongStatus.selector, id, status);
    }

    // ---- Acceptance tests

    function test_AT05_issueMintsToSeller() public {
        uint256 relId = _relateDemo();
        uint256 id = _issue(relId, FACE);

        assertEq(invoices.ownerOf(id), address(D));
        Invoice memory inv = _invoice(id);
        assertEq(uint8(inv.status), uint8(InvoiceStatus.Issued));
        assertEq(inv.seller, address(D));
        assertEq(inv.buyer, address(C));
        assertEq(inv.faceValue, FACE);
        assertEq(inv.dueDate, block.timestamp + 30 days);
        assertEq(inv.relationshipId, relId);
    }

    function test_AT10_payUnfundedInvoiceThroughSellerRoute() public {
        _setTaxRoute();
        uint256 id = _approvedInvoice();

        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.expectEmit(address(invoices));
        emit InvoicePaid(id, address(C), address(D), uint128(FACE));
        vm.prank(c2);
        C.confirm(opId);

        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(tax), 500e6);
        assertEq(usdc.balanceOf(address(D)), 4_500e6);
        assertEq(usdc.balanceOf(address(C)), 0);
        assertEq(invoices.ownerOf(id), address(D), "the NFT stays as the paid record");
    }

    function test_AT11_strangerSettlesEscrowOnlyAfterDueDate() public {
        uint256 id = _approvedInvoice();
        _clubEscrow(id);

        vm.warp(_invoice(id).dueDate - 1);
        vm.expectRevert(abi.encodeWithSelector(ZalInvoice.NotPayable.selector, id));
        vm.prank(stranger);
        invoices.payInvoice(id);

        vm.warp(_invoice(id).dueDate);
        vm.prank(stranger);
        invoices.payInvoice(id);
        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Paid));
        assertEq(usdc.balanceOf(address(D)), FACE);
        assertEq(usdc.balanceOf(address(invoices)), 0);
        assertEq(invoices.totalEscrowed(), 0);
    }

    function test_AT12_nftMovesOnlyFromSellerToPool() public {
        uint256 id = _approvedInvoice();
        vm.startPrank(address(D));
        vm.expectRevert(ZalInvoice.TransferRestricted.selector);
        invoices.transferFrom(address(D), stranger, id);
        vm.expectRevert(ZalInvoice.TransferRestricted.selector);
        invoices.safeTransferFrom(address(D), address(C), id);
        vm.stopPrank();
    }

    // ---- Issue

    function test_issueChecks() public {
        uint256 relId = _relateDemo();
        uint64 due = uint64(block.timestamp + 30 days);

        vm.expectRevert(ZalInvoice.NotSeller.selector);
        vm.prank(c1);
        C.issueInvoice(relId, uint128(FACE), due, bytes32(0));

        vm.startPrank(d);
        vm.expectRevert(ZalInvoice.ZeroFaceValue.selector);
        D.issueInvoice(relId, 0, due, bytes32(0));
        vm.expectRevert(ZalInvoice.DueDateNotInFuture.selector);
        D.issueInvoice(relId, uint128(FACE), uint64(block.timestamp), bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(ZalInvoice.RelationshipNotActive.selector, 99));
        D.issueInvoice(99, uint128(FACE), due, bytes32(0));
        vm.stopPrank();
    }

    function test_issueNeedsActiveRelationship() public {
        vm.startPrank(d);
        uint256 relId = D.proposeRelationship(address(C), Role.Seller, 0);
        vm.expectRevert(abi.encodeWithSelector(ZalInvoice.RelationshipNotActive.selector, relId));
        D.issueInvoice(relId, uint128(FACE), uint64(block.timestamp + 1 days), bytes32(0));
        vm.stopPrank();
    }

    // ---- Approve, reject, cancel

    function test_onlyBuyerApprovesOrRejects() public {
        uint256 id = _issue(_relateDemo(), FACE);
        vm.startPrank(address(D));
        vm.expectRevert(ZalInvoice.NotBuyer.selector);
        invoices.approveInvoice(id);
        vm.expectRevert(ZalInvoice.NotBuyer.selector);
        invoices.rejectInvoice(id);
        vm.stopPrank();
    }

    function test_rejectIsTerminal() public {
        uint256 id = _issue(_relateDemo(), FACE);
        vm.prank(c1);
        C.rejectInvoice(id);
        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Rejected));

        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.approveInvoice, (id, 0)));
        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Rejected));
        vm.prank(c2);
        C.confirm(opId);
        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Rejected));
        vm.prank(d);
        D.cancelInvoice(id);
    }

    function test_cancelBurnsAndIsTerminal() public {
        uint256 id = _issue(_relateDemo(), FACE);
        vm.expectRevert(ZalInvoice.NotSeller.selector);
        vm.prank(address(C));
        invoices.cancelInvoice(id);

        vm.prank(d);
        D.cancelInvoice(id);
        assertEq(uint8(_invoice(id).status), uint8(InvoiceStatus.Cancelled));
        vm.expectRevert(abi.encodeWithSelector(IERC721Errors.ERC721NonexistentToken.selector, id));
        invoices.ownerOf(id);

        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Cancelled));
        vm.prank(c1);
        C.rejectInvoice(id);
    }

    function test_cancelAfterApprovalReverts() public {
        uint256 id = _approvedInvoice();
        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Approved));
        vm.prank(d);
        D.cancelInvoice(id);
    }

    // ---- Escrow

    function test_escrowOnceAndOnlyByBuyer() public {
        uint256 id = _approvedInvoice();
        usdc.mint(address(C), FACE);
        _clubEscrow(id);

        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.escrowInvoice, (id)));
        vm.expectRevert(abi.encodeWithSelector(ZalInvoice.AlreadyEscrowed.selector, id));
        vm.prank(c2);
        C.confirm(opId);

        usdc.mint(stranger, FACE);
        vm.startPrank(stranger);
        usdc.approve(address(invoices), FACE);
        vm.expectRevert(ZalInvoice.NotBuyer.selector);
        invoices.escrowInvoice(id);
        vm.stopPrank();
    }

    function test_escrowNeedsApprovedInvoice() public {
        uint256 id = _issue(_relateDemo(), FACE);
        usdc.mint(address(C), FACE);
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.escrowInvoice, (id)));
        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Issued));
        vm.prank(c2);
        C.confirm(opId);
    }

    // ---- Pay

    function test_buyerPaysEscrowedInvoiceEarly() public {
        uint256 id = _approvedInvoice();
        _clubEscrow(id);
        _clubPay(id);
        assertEq(usdc.balanceOf(address(D)), FACE);
        assertEq(usdc.balanceOf(address(invoices)), 0);
        assertEq(_invoice(id).escrowed, 0);
    }

    function test_onlyBuyerPaysUnescrowedInvoice() public {
        uint256 id = _approvedInvoice();
        vm.warp(_invoice(id).dueDate + 1);
        usdc.mint(stranger, FACE);
        vm.startPrank(stranger);
        usdc.approve(address(invoices), FACE);
        vm.expectRevert(abi.encodeWithSelector(ZalInvoice.NotPayable.selector, id));
        invoices.payInvoice(id);
        vm.stopPrank();
    }

    function test_payOnlyOnce() public {
        uint256 id = _approvedInvoice();
        _clubPay(id);
        usdc.mint(address(C), FACE);
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Paid));
        vm.prank(c2);
        C.confirm(opId);
    }

    function test_payNeedsApprovedInvoice() public {
        uint256 id = _issue(_relateDemo(), FACE);
        usdc.mint(address(C), FACE);
        vm.prank(c1);
        uint256 opId = C.submit(abi.encodeCall(CanvasAccount.payInvoice, (id)));
        vm.expectRevert(_wrongStatus(id, InvoiceStatus.Issued));
        vm.prank(c2);
        C.confirm(opId);
    }

    // ---- Transfer restriction

    function test_issuedInvoiceCannotMoveToPool() public {
        uint256 id = _issue(_relateDemo(), FACE);
        vm.expectRevert(ZalInvoice.TransferRestricted.selector);
        vm.prank(address(D));
        invoices.transferFrom(address(D), address(pool), id);
    }

    /// @dev Otherwise the pool would own an NFT with no advance, and the invoice could never be paid.
    function test_sellerCannotPushTheNftToThePool() public {
        uint256 id = _approvedInvoice();
        vm.expectRevert(ZalInvoice.TransferRestricted.selector);
        vm.prank(address(D));
        invoices.transferFrom(address(D), address(pool), id);
    }

    function test_poolCannotMoveTheNftOn() public {
        uint256 id = _escrowedInvoice();
        _lpDeposit(10_000e6);
        _advance(id);
        vm.expectRevert(ZalInvoice.TransferRestricted.selector);
        vm.prank(address(pool));
        invoices.transferFrom(address(pool), stranger, id);
    }

    function test_paidInvoiceCannotMove() public {
        uint256 id = _approvedInvoice();
        _clubPay(id);
        vm.expectRevert(ZalInvoice.TransferRestricted.selector);
        vm.prank(address(D));
        invoices.transferFrom(address(D), address(pool), id);
    }
}
