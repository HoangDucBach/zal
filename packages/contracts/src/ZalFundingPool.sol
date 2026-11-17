// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ICanvasAccount} from "./interfaces/ICanvasAccount.sol";
import {IZalFundingPool} from "./interfaces/IZalFundingPool.sol";
import {IZalInvoice} from "./interfaces/IZalInvoice.sol";
import {Advance, Invoice, InvoiceStatus} from "./lib/ZalTypes.sol";

/// @dev LP deposits, advances against buyer-approved invoices, and the repayment split (reverse factoring).
/// A buyer approval costs nothing, so the pool lends only against escrowed cash or a buyer its owner has
/// underwritten (ZR-FND-07).
/// Fees are recognised on repayment, not accrued (known issue K-1). An unpaid funded invoice stays in
/// `outstanding` with no write-down (known issue K-2).
contract ZalFundingPool is IZalFundingPool, ERC4626, Ownable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;

    IZalInvoice public immutable invoices;

    uint16 public advanceRateBps;
    uint16 public annualFeeBps;
    /// @dev Sum of open advance principal (INV-01).
    uint256 public outstanding;
    /// @dev Cap on a buyer's open unescrowed advance principal. 0 means the buyer is not enrolled.
    mapping(address buyer => uint256) public obligorLimit;
    /// @dev Sum of the buyer's open advance principal that was lent on its limit (INV-10).
    mapping(address buyer => uint256) public obligorOutstanding;
    mapping(uint256 invoiceId => Advance) private _advances;

    event RatesSet(uint16 advanceRateBps, uint16 annualFeeBps);
    event ObligorLimitSet(address indexed buyer, uint256 limit);
    /// @dev `onCredit` lets the indexer rebuild `obligorOutstanding` from events alone (ZR-SYS-02, INV-10).
    event Advanced(uint256 indexed invoiceId, address indexed seller, uint128 principal, uint128 fee, bool onCredit);
    event Repaid(uint256 indexed invoiceId, uint128 principal, uint128 fee, uint128 reserve);

    error InvalidAdvanceRate();
    error NotSeller();
    error AlreadyFunded(uint256 invoiceId);
    error NotApproved(uint256 invoiceId);
    error PastDue(uint256 invoiceId);
    error ZeroPrincipal();
    error FeeExceedsReserve(uint256 principal, uint256 fee, uint256 faceValue);
    error ObligorLimitExceeded(address buyer, uint256 required, uint256 limit);
    error InsufficientIdleCash(uint256 principal, uint256 idle);
    error NotInvoiceContract();
    error NoAdvance(uint256 invoiceId);
    error WrongRepayment(uint256 amount, uint256 faceValue);

    constructor(IERC20 usdc, IZalInvoice invoices_, address owner_, uint16 advanceRateBps_, uint16 annualFeeBps_)
        ERC4626(usdc)
        ERC20("Zal Funding Pool LP", "zFP")
        Ownable(owner_)
    {
        invoices = invoices_;
        _setRates(advanceRateBps_, annualFeeBps_);
    }

    /// @dev Applies to later advances only. The fee of an open advance was fixed when it was funded (ZR-FND-02).
    function setRates(uint16 advanceRateBps_, uint16 annualFeeBps_) external onlyOwner {
        _setRates(advanceRateBps_, annualFeeBps_);
    }

    /// @dev ZR-FND-07. Applies to later advances only. A limit below the buyer's open principal blocks new
    /// unescrowed advances until repayments bring it back under.
    function setObligorLimit(address buyer, uint256 limit) external onlyOwner {
        obligorLimit[buyer] = limit;
        emit ObligorLimitSet(buyer, limit);
    }

    function advanceOf(uint256 invoiceId) external view returns (Advance memory) {
        return _advances[invoiceId];
    }

    function idleCash() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @dev ZR-FND-02. Principal rounds down and the fee rounds up, so rounding favours the pool.
    /// The fee is charged on the rounded principal, which is the amount actually lent.
    function quote(uint256 faceValue, uint256 dueDate) public view returns (uint256 principal, uint256 fee) {
        principal = faceValue * advanceRateBps / BPS;
        // forge-lint: disable-next-line(divide-before-multiply)
        fee = Math.mulDiv(principal * annualFeeBps, dueDate - block.timestamp, BPS * YEAR, Math.Rounding.Ceil);
    }

    /// @dev ZR-FND-01..03, ZR-FND-07. The seller account approved this pool for the NFT before it calls. The principal lands
    /// in the seller account as a plain transfer. It does not pass through the seller's route.
    function advance(uint256 invoiceId) external nonReentrant {
        Invoice memory inv = invoices.getInvoice(invoiceId);
        if (msg.sender != inv.seller) revert NotSeller();
        if (inv.status != InvoiceStatus.Approved) revert NotApproved(invoiceId);
        if (invoices.ownerOf(invoiceId) != inv.seller) revert AlreadyFunded(invoiceId);
        if (inv.dueDate <= block.timestamp) revert PastDue(invoiceId);

        (uint256 quotedPrincipal, uint256 quotedFee) = quote(inv.faceValue, inv.dueDate);
        if (quotedPrincipal == 0) revert ZeroPrincipal();
        if (quotedPrincipal + quotedFee > inv.faceValue) {
            revert FeeExceedsReserve(quotedPrincipal, quotedFee, inv.faceValue);
        }
        // Escrow cannot be withdrawn, so an escrowed invoice carries no credit risk and uses no limit.
        bool onCredit = inv.escrowed != inv.faceValue;
        if (onCredit) {
            uint256 required = obligorOutstanding[inv.buyer] + quotedPrincipal;
            uint256 limit = obligorLimit[inv.buyer];
            if (required > limit) revert ObligorLimitExceeded(inv.buyer, required, limit);
            obligorOutstanding[inv.buyer] = required;
        }
        uint256 idle = idleCash();
        if (quotedPrincipal > idle) revert InsufficientIdleCash(quotedPrincipal, idle);

        uint128 principal = SafeCast.toUint128(quotedPrincipal);
        uint128 fee = SafeCast.toUint128(quotedFee);
        _advances[invoiceId] = Advance({
            seller: inv.seller,
            principal: principal,
            fee: fee,
            fundedAt: SafeCast.toUint64(block.timestamp),
            onCredit: onCredit
        });
        outstanding += principal;

        invoices.transferFrom(inv.seller, address(this), invoiceId);
        IERC20(asset()).safeTransfer(inv.seller, principal);
        emit Advanced(invoiceId, inv.seller, principal, fee, onCredit);
    }

    /// @dev ZR-FND-04. ZalInvoice has already transferred `amount` here. The pool keeps principal and fee and
    /// sends the reserve through the seller's route.
    function onRepaid(uint256 invoiceId, uint256 amount) external nonReentrant {
        if (msg.sender != address(invoices)) revert NotInvoiceContract();
        Advance memory adv = _advances[invoiceId];
        if (adv.seller == address(0)) revert NoAdvance(invoiceId);
        Invoice memory inv = invoices.getInvoice(invoiceId);
        uint128 face = inv.faceValue;
        if (amount != face) revert WrongRepayment(amount, face);

        uint128 reserve = face - adv.principal - adv.fee;
        outstanding -= adv.principal;
        if (adv.onCredit) obligorOutstanding[inv.buyer] -= adv.principal;
        delete _advances[invoiceId];

        if (reserve != 0) {
            IERC20(asset()).safeTransfer(adv.seller, reserve);
            ICanvasAccount(adv.seller).receivePayment(invoiceId, reserve);
        }
        emit Repaid(invoiceId, adv.principal, adv.fee, reserve);
    }

    /// @dev INV-01. USDC sent to the pool outside `deposit` counts as LP assets.
    function totalAssets() public view override returns (uint256) {
        return idleCash() + outstanding;
    }

    /// @dev ZR-FND-05. Computed from the share balance, not from `maxRedeem`, so that an LP whose claim covers
    /// the idle cash can withdraw exactly all of it.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(_convertToAssets(balanceOf(owner_), Math.Rounding.Floor), idleCash());
    }

    /// @dev ZR-FND-05.
    function maxRedeem(address owner_) public view override returns (uint256) {
        return Math.min(balanceOf(owner_), _convertToShares(idleCash(), Math.Rounding.Floor));
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    /// @dev ZR-FND-06.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _setRates(uint16 advanceRateBps_, uint16 annualFeeBps_) private {
        if (advanceRateBps_ == 0 || advanceRateBps_ > BPS) revert InvalidAdvanceRate();
        advanceRateBps = advanceRateBps_;
        annualFeeBps = annualFeeBps_;
        emit RatesSet(advanceRateBps_, annualFeeBps_);
    }
}
