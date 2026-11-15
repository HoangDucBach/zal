// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ICanvasAccount} from "./interfaces/ICanvasAccount.sol";
import {IRelationshipRegistry} from "./interfaces/IRelationshipRegistry.sol";
import {IZalFactory} from "./interfaces/IZalFactory.sol";
import {IZalFundingPool} from "./interfaces/IZalFundingPool.sol";
import {IZalInvoice} from "./interfaces/IZalInvoice.sol";
import {Invoice, InvoiceStatus, Relationship, RelStatus} from "./lib/ZalTypes.sol";

/// @dev Invoice NFTs, the invoice state machine, escrow, and settlement. Parties are CanvasAccounts and
/// `msg.sender` is the acting account. An invoice is funded exactly when `ownerOf(id)` is the funding pool, and
/// the payment recipient is always `ownerOf(id)` (INV-06).
contract ZalInvoice is IZalInvoice, ERC721, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IZalFactory public immutable factory;
    IERC20 public immutable usdc;

    uint256 public invoiceCount;
    /// @dev USDC held in escrow. Equals this contract's USDC balance unless someone sent it tokens (INV-07).
    uint256 public totalEscrowed;
    mapping(uint256 id => Invoice) private _invoices;

    event InvoiceIssued(
        uint256 indexed id,
        uint256 indexed relationshipId,
        address indexed seller,
        address buyer,
        uint128 faceValue,
        uint64 dueDate,
        bytes32 docHash
    );
    event InvoiceApproved(uint256 indexed id, address indexed buyer, address indexed seller);
    event InvoiceRejected(uint256 indexed id, address indexed buyer, address indexed seller);
    event InvoiceCancelled(uint256 indexed id, address indexed buyer, address indexed seller);
    event InvoiceEscrowed(uint256 indexed id, address indexed buyer, uint128 amount);
    event InvoicePaid(uint256 indexed id, address indexed payer, address indexed recipient, uint128 faceValue);

    error RelationshipNotActive(uint256 relationshipId);
    error NotSeller();
    error NotBuyer();
    error ZeroFaceValue();
    error DueDateNotInFuture();
    error WrongStatus(uint256 id, InvoiceStatus status);
    error AlreadyEscrowed(uint256 id);
    error NotPayable(uint256 id);
    error TransferRestricted();

    constructor(IZalFactory factory_, IERC20 usdc_) ERC721("Zal Invoice", "ZINV") {
        factory = factory_;
        usdc = usdc_;
    }

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _invoices[id];
    }

    /// @dev ZR-INV-01. The relationship's parties were checked as accounts when it was created.
    function issueInvoice(uint256 relationshipId, uint128 faceValue, uint64 dueDate, bytes32 docHash)
        external
        returns (uint256 id)
    {
        Relationship memory rel = IRelationshipRegistry(factory.registry()).getRelationship(relationshipId);
        if (rel.status != RelStatus.Active) revert RelationshipNotActive(relationshipId);
        if (msg.sender != rel.seller) revert NotSeller();
        if (faceValue == 0) revert ZeroFaceValue();
        if (dueDate <= block.timestamp) revert DueDateNotInFuture();

        id = ++invoiceCount;
        _invoices[id] = Invoice({
            relationshipId: relationshipId,
            seller: rel.seller,
            buyer: rel.buyer,
            faceValue: faceValue,
            escrowed: 0,
            issuedAt: SafeCast.toUint64(block.timestamp),
            dueDate: dueDate,
            approvedAt: 0,
            status: InvoiceStatus.Issued,
            docHash: docHash
        });
        // `_mint`, not `_safeMint`: the seller is a CanvasAccount and must not get a callback here.
        // forge-lint: disable-next-line(unsafe-oz-erc721-mint)
        _mint(rel.seller, id);
        emit InvoiceIssued(id, relationshipId, rel.seller, rel.buyer, faceValue, dueDate, docHash);
    }

    /// @dev ZR-INV-02.
    function approveInvoice(uint256 id) external {
        Invoice storage inv = _invoices[id];
        _requireStatus(id, inv, InvoiceStatus.Issued);
        if (msg.sender != inv.buyer) revert NotBuyer();
        inv.status = InvoiceStatus.Approved;
        inv.approvedAt = SafeCast.toUint64(block.timestamp);
        emit InvoiceApproved(id, inv.buyer, inv.seller);
    }

    /// @dev ZR-INV-02.
    function rejectInvoice(uint256 id) external {
        Invoice storage inv = _invoices[id];
        _requireStatus(id, inv, InvoiceStatus.Issued);
        if (msg.sender != inv.buyer) revert NotBuyer();
        inv.status = InvoiceStatus.Rejected;
        emit InvoiceRejected(id, inv.buyer, inv.seller);
    }

    /// @dev ZR-INV-05. An Issued invoice is always still owned by its seller, because the NFT moves only while
    /// Approved (ZR-INV-04).
    function cancelInvoice(uint256 id) external {
        Invoice storage inv = _invoices[id];
        _requireStatus(id, inv, InvoiceStatus.Issued);
        if (msg.sender != inv.seller) revert NotSeller();
        inv.status = InvoiceStatus.Cancelled;
        _burn(id);
        emit InvoiceCancelled(id, inv.buyer, inv.seller);
    }

    /// @dev ZR-INV-03. The buyer account approves `faceValue` to this contract before it calls.
    function escrowInvoice(uint256 id) external nonReentrant {
        Invoice storage inv = _invoices[id];
        _requireStatus(id, inv, InvoiceStatus.Approved);
        if (msg.sender != inv.buyer) revert NotBuyer();
        if (inv.escrowed != 0) revert AlreadyEscrowed(id);
        uint128 face = inv.faceValue;
        inv.escrowed = face;
        totalEscrowed += face;
        usdc.safeTransferFrom(msg.sender, address(this), face);
        emit InvoiceEscrowed(id, msg.sender, face);
    }

    /// @dev ZR-PAY-01..04. Funds come from escrow when the invoice is escrowed. Otherwise the buyer account has
    /// approved `faceValue` to this contract and the money goes straight from the buyer to the recipient.
    function payInvoice(uint256 id) external nonReentrant {
        Invoice storage inv = _invoices[id];
        _requireStatus(id, inv, InvoiceStatus.Approved);
        uint128 face = inv.faceValue;
        bool fromEscrow = inv.escrowed == face;
        bool isBuyer = msg.sender == inv.buyer;
        if (!isBuyer && !(fromEscrow && block.timestamp >= inv.dueDate)) revert NotPayable(id);

        inv.status = InvoiceStatus.Paid;
        address recipient = _ownerOf(id);
        if (fromEscrow) {
            inv.escrowed = 0;
            totalEscrowed -= face;
            usdc.safeTransfer(recipient, face);
        } else {
            usdc.safeTransferFrom(msg.sender, recipient, face);
        }

        if (recipient == inv.seller) {
            ICanvasAccount(recipient).receivePayment(id, face);
        } else {
            IZalFundingPool(recipient).onRepaid(id, face);
        }
        emit InvoicePaid(id, msg.sender, recipient, face);
    }

    /// @dev ZR-INV-04 and INV-09. Mint and burn happen only inside `issueInvoice` and `cancelInvoice`. The one
    /// allowed transfer is seller to funding pool while Approved, and only the pool may make it. The pool does so
    /// inside `advance`, so the pool never holds an NFT without an open advance.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            Invoice storage inv = _invoices[tokenId];
            if (msg.sender != to || from != inv.seller || to != factory.pool() || inv.status != InvoiceStatus.Approved) revert TransferRestricted();
        }
        return super._update(to, tokenId, auth);
    }

    function _requireStatus(uint256 id, Invoice storage inv, InvoiceStatus expected) private view {
        if (inv.status != expected) revert WrongStatus(id, inv.status);
    }
}
