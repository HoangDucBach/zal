// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ICanvasAccount} from "./interfaces/ICanvasAccount.sol";
import {IRelationshipRegistry} from "./interfaces/IRelationshipRegistry.sol";
import {IZalFactory} from "./interfaces/IZalFactory.sol";
import {IZalFundingPool} from "./interfaces/IZalFundingPool.sol";
import {IZalInvoice} from "./interfaces/IZalInvoice.sol";
import {
    Budget,
    Invite,
    Invoice,
    InvoiceStatus,
    Leg,
    LegKind,
    MemberRole,
    Role,
    Schedule,
    ScheduleKind
} from "./lib/ZalTypes.sol";

/// @dev One per canvas, deployed as an ERC-1167 clone by ZalFactory. Holds USDC and is the party of record in
/// every relationship and invoice. An Admin is fully trusted: one Admin can change members, policy and the
/// receive route alone. The confirmation threshold protects the five gated spending operations only.
contract CanvasAccount is ICanvasAccount, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Op {
        bytes data;
        uint256 amount;
        uint64 policyNonce;
        uint32 confirmations;
        bool executed;
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_LEGS = 8;
    uint64 public constant DEFAULT_BUDGET_PERIOD = 30 days;
    /// @dev ZR-SCH-02. The least time between creating a schedule and its first run, and between two runs.
    uint64 public constant MIN_SCHEDULE_DELAY = 60;
    uint32 public constant MIN_SCHEDULE_INTERVAL = 60;
    uint32 public constant MAX_SCHEDULE_RUNS = 1000;
    /// @dev ZR-ACC-11.
    uint64 public constant SPEND_WINDOW = 1 days;

    IZalFactory public immutable factory;

    /// @dev Copied from the factory at `initialize`. The factory wiring is set once and never changes.
    IERC20 public usdc;
    IRelationshipRegistry public registry;
    IZalInvoice public invoices;
    address public pool;

    mapping(address member => MemberRole) public roleOf;
    uint32 public adminCount;
    /// @dev Approvers and Admins.
    uint32 public approverCount;
    uint8 public threshold;
    uint128 public approvalLimit;
    /// @dev Bumped on every member or policy change. An op is live only while its nonce is current (ZR-ACC-05).
    uint64 public policyNonce;
    /// @dev Display flag for the Zal UI only. The route is always readable on-chain.
    bool public endpointPublic;
    /// @dev ZR-ACC-11. Single-confirmation spend since `windowStart`. Read through `spendWindow`.
    uint64 private windowStart;
    uint128 private windowSpent;

    uint256 public opCount;
    mapping(uint256 opId => Op) private _ops;
    mapping(uint256 opId => mapping(address approver => bool)) public hasConfirmed;

    mapping(uint256 budgetId => Budget) public budgets;
    Leg[] private _route;

    uint256 public scheduleCount;
    mapping(uint256 scheduleId => Schedule) private _schedules;

    event MemberSet(address indexed member, MemberRole role, uint64 policyNonce);
    event PolicySet(uint8 threshold, uint128 approvalLimit, uint64 policyNonce);
    /// @dev Carries the full call, so approvers and the indexer see which invoice or recipient an op is for.
    event OpSubmitted(uint256 indexed opId, bytes4 indexed selector, uint256 amount, address indexed by, bytes data);
    event OpConfirmed(uint256 indexed opId, address indexed by, uint32 confirmations);
    event OpRevoked(uint256 indexed opId, address indexed by, uint32 confirmations);
    event OpExecuted(uint256 indexed opId, address indexed by);
    event SpendWindowCharged(uint256 indexed opId, uint128 amount, uint128 windowSpent, uint64 windowStart);
    event BudgetSet(uint256 indexed budgetId, uint128 limit, uint64 periodLength);
    event BudgetCharged(uint256 indexed budgetId, uint256 indexed invoiceId, uint128 amount, uint128 used);
    event RouteSet(Leg[] legs);
    event PaymentRouted(uint256 indexed invoiceId, uint256 amount, uint256[] legAmounts);
    event LegFailed(uint256 indexed invoiceId, uint256 legIndex, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event VaultDeposited(address indexed vault, uint256 assets, uint256 shares);
    event VaultRedeemed(address indexed vault, uint256 shares, uint256 assets);
    event EndpointVisibilitySet(bool endpointPublic);
    /// @dev `recipient` is zero for PayInvoice and `invoiceId` is zero for Transfer. `amount` is what one run pays.
    event ScheduleCreated(
        uint256 indexed id,
        ScheduleKind kind,
        address indexed recipient,
        uint256 indexed invoiceId,
        uint128 amount,
        uint64 start,
        uint32 interval,
        uint32 runs
    );
    event ScheduleCancelled(uint256 indexed id, address indexed by);
    /// @dev `runAt` is the block time of the run, which can be later than the time it was due.
    event ScheduleRan(uint256 indexed id, uint64 runAt, uint128 amountPaid, uint32 remaining);

    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error NotAdmin();
    error NotApprover();
    error NotSelf();
    error NotSettlement();
    error LastAdmin();
    error InvalidThreshold();
    error OpNotAllowed();
    error OpNotFound(uint256 opId);
    error OpAlreadyExecuted(uint256 opId);
    error OpStale(uint256 opId);
    error AlreadyConfirmed(uint256 opId);
    error NotConfirmed(uint256 opId);
    error InvalidBudget();
    error BudgetNotFound(uint256 budgetId);
    error BudgetExceeded(uint256 budgetId, uint256 used, uint256 amount, uint256 limit);
    error InvalidRoute();
    error VaultNotAllowed(address vault);
    error ScheduleStartTooSoon(uint64 start, uint256 earliest);
    error InvalidScheduleTiming(uint32 interval, uint32 runs);
    error InvalidScheduleRecipient(address recipient);
    error InvoiceNotSchedulable(uint256 invoiceId);
    error ScheduleNotActive(uint256 id);
    error ScheduleNotDue(uint256 id, uint64 nextAt);

    modifier onlyAdmin() {
        if (roleOf[msg.sender] != MemberRole.Admin) revert NotAdmin();
        _;
    }

    modifier onlyApprover() {
        if (!_isApprover(roleOf[msg.sender])) revert NotApprover();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    /// @dev The factory deploys the implementation, so every clone shares this immutable.
    constructor() {
        factory = IZalFactory(msg.sender);
    }

    /// @dev ZR-ACC-01. `adminCount` is never 0 after this runs, so it doubles as the initialized flag.
    function initialize(address admin) external {
        if (msg.sender != address(factory)) revert NotFactory();
        if (adminCount != 0) revert AlreadyInitialized();
        if (admin == address(0)) revert ZeroAddress();

        usdc = IERC20(factory.usdc());
        registry = IRelationshipRegistry(factory.registry());
        invoices = IZalInvoice(factory.invoices());
        pool = factory.pool();

        roleOf[admin] = MemberRole.Admin;
        adminCount = 1;
        approverCount = 1;
        threshold = 1;
        policyNonce = 1;
        emit MemberSet(admin, MemberRole.Admin, 1);
        emit PolicySet(1, 0, 1);
    }

    // ---- Members and policy

    /// @dev ZR-ACC-02, ZR-ACC-05. A change that would leave fewer approvers than `threshold` reverts. Lower the
    /// threshold first.
    function setMember(address member, MemberRole role) external onlyAdmin {
        if (member == address(0)) revert ZeroAddress();
        MemberRole old = roleOf[member];
        if (_isApprover(old)) --approverCount;
        if (old == MemberRole.Admin) --adminCount;
        if (_isApprover(role)) ++approverCount;
        if (role == MemberRole.Admin) ++adminCount;
        if (adminCount == 0) revert LastAdmin();
        if (approverCount < threshold) revert InvalidThreshold();
        roleOf[member] = role;
        emit MemberSet(member, role, ++policyNonce);
    }

    /// @dev ZR-ACC-05.
    function setPolicy(uint8 threshold_, uint128 approvalLimit_) external onlyAdmin {
        if (threshold_ == 0 || threshold_ > approverCount) revert InvalidThreshold();
        threshold = threshold_;
        approvalLimit = approvalLimit_;
        emit PolicySet(threshold_, approvalLimit_, ++policyNonce);
    }

    function setEndpointPublic(bool endpointPublic_) external onlyAdmin {
        endpointPublic = endpointPublic_;
        emit EndpointVisibilitySet(endpointPublic_);
    }

    // ---- Gated operations

    /// @dev ZR-ACC-04, ZR-ACC-11. Priced against the spend window as it stands now, so an op that needed one
    /// confirmation when it was submitted can need `threshold` by the time it would execute.
    function requiredConfirmations(uint256 amount) public view returns (uint256) {
        return _spentInWindow() + amount > approvalLimit ? threshold : 1;
    }

    /// @dev ZR-ACC-11. `spent` is 0 once the window has expired; `start` is then the old window's start.
    function spendWindow() external view returns (uint64 start, uint128 spent, uint128 remaining) {
        start = windowStart;
        spent = _spentInWindow();
        uint128 limit = approvalLimit;
        remaining = spent < limit ? limit - spent : 0;
    }

    function getOp(uint256 opId) external view returns (Op memory) {
        return _ops[opId];
    }

    /// @dev ZR-ACC-03. `data` is an ABI-encoded call to one of the five gated functions of this account. The
    /// submitter's confirmation counts, so with one required confirmation the op executes here.
    function submit(bytes calldata data) external nonReentrant onlyApprover returns (uint256 opId) {
        (bytes4 selector, uint256 amount) = _gatedAmount(data);
        opId = ++opCount;
        Op storage op = _ops[opId];
        op.data = data;
        op.amount = amount;
        op.policyNonce = policyNonce;
        emit OpSubmitted(opId, selector, amount, msg.sender, data);
        _confirm(opId, op);
    }

    /// @dev ZR-ACC-04. Executes inside the confirmation that reaches the required count. If the gated call
    /// reverts, this confirmation reverts with it and can be sent again later.
    function confirm(uint256 opId) external nonReentrant onlyApprover {
        _confirm(opId, _liveOp(opId));
    }

    function revoke(uint256 opId) external nonReentrant {
        Op storage op = _liveOp(opId);
        if (!hasConfirmed[opId][msg.sender]) revert NotConfirmed(opId);
        hasConfirmed[opId][msg.sender] = false;
        emit OpRevoked(opId, msg.sender, --op.confirmations);
    }

    /// @dev Reserves budget, then approves. Approval is the only charge; payment does not charge again (ZR-ACC-06).
    function approveInvoice(uint256 invoiceId, uint256 budgetId) external onlySelf {
        if (budgetId != 0) _chargeBudget(budgetId, invoiceId, invoices.getInvoice(invoiceId).faceValue);
        invoices.approveInvoice(invoiceId);
    }

    function escrowInvoice(uint256 invoiceId) external onlySelf {
        usdc.forceApprove(address(invoices), invoices.getInvoice(invoiceId).faceValue);
        invoices.escrowInvoice(invoiceId);
    }

    /// @dev ZalInvoice pulls exactly `faceValue` when the invoice is not escrowed, so the allowance ends at 0.
    function payInvoice(uint256 invoiceId) external onlySelf {
        _payInvoice(invoiceId);
    }

    function withdraw(address to, uint256 amount) external onlySelf {
        if (to == address(0)) revert ZeroAddress();
        usdc.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @dev ZR-SCH-01..03. Approving this op is the spend control for every run it allows: `submit` prices it at
    /// `amount * runs` for a Transfer and at the face value for a PayInvoice. Runs charge no budget. `start` is
    /// checked when the op executes, so it must still be 60 s ahead when the last confirmation lands.
    /// A schedule is not tied to `policyNonce`. A later member or policy change leaves it running, because the
    /// approvers of the time agreed to all of its runs. Stopping it takes one `cancelSchedule`.
    /// For a PayInvoice the `recipient` and `amount` arguments are ignored; for a Transfer `invoiceId` is.
    function createSchedule(
        ScheduleKind kind,
        address recipient,
        uint256 invoiceId,
        uint128 amount,
        uint64 start,
        uint32 interval,
        uint32 runs
    ) external onlySelf returns (uint256 id) {
        uint256 earliest = block.timestamp + MIN_SCHEDULE_DELAY;
        if (start < earliest) revert ScheduleStartTooSoon(start, earliest);
        bool once = interval == 0 && runs == 1;
        if (kind == ScheduleKind.Transfer) {
            bool recurring = interval >= MIN_SCHEDULE_INTERVAL && runs != 0 && runs <= MAX_SCHEDULE_RUNS;
            if (!once && !recurring) revert InvalidScheduleTiming(interval, runs);
            if (recipient == address(0) || recipient == address(this)) revert InvalidScheduleRecipient(recipient);
            invoiceId = 0;
        } else {
            if (!once) revert InvalidScheduleTiming(interval, runs);
            Invoice memory inv = invoices.getInvoice(invoiceId);
            if (inv.status != InvoiceStatus.Approved || inv.buyer != address(this)) {
                revert InvoiceNotSchedulable(invoiceId);
            }
            recipient = address(0);
            amount = inv.faceValue;
        }

        id = ++scheduleCount;
        _schedules[id] = Schedule({
            kind: kind,
            recipient: recipient,
            invoiceId: invoiceId,
            amount: amount,
            nextAt: start,
            interval: interval,
            remaining: runs,
            active: true
        });
        emit ScheduleCreated(id, kind, recipient, invoiceId, amount, start, interval, runs);
    }

    // ---- Schedules

    /// @dev ZR-SCH-04. One Approver or Admin is enough, so stopping money is never harder than starting it.
    function cancelSchedule(uint256 id) external onlyApprover {
        Schedule storage schedule = _schedules[id];
        if (!schedule.active) revert ScheduleNotActive(id);
        schedule.active = false;
        emit ScheduleCancelled(id, msg.sender);
    }

    /// @dev ZR-SCH-05..07, INV-11. Open to anyone: the caller chooses nothing, and the run pays only the amount
    /// and target that `createSchedule` stored. The schedule advances before the payment, so a payment that
    /// reverts undoes the advance and the run stays due. A schedule that fell behind can be run once per missed
    /// due time, back to back.
    /// A PayInvoice run goes through `ZalInvoice.payInvoice`, which reverts unless the invoice is still Approved.
    /// If the invoice was paid another way, the run keeps reverting until someone cancels the schedule.
    function runSchedule(uint256 id) external nonReentrant {
        Schedule storage schedule = _schedules[id];
        if (!schedule.active) revert ScheduleNotActive(id);
        uint64 dueAt = schedule.nextAt;
        if (block.timestamp < dueAt) revert ScheduleNotDue(id, dueAt);

        uint32 remaining = schedule.remaining - 1;
        schedule.remaining = remaining;
        schedule.nextAt = dueAt + schedule.interval;
        if (remaining == 0) schedule.active = false;

        uint128 amount = schedule.amount;
        if (schedule.kind == ScheduleKind.Transfer) {
            usdc.safeTransfer(schedule.recipient, amount);
        } else {
            _payInvoice(schedule.invoiceId);
        }
        emit ScheduleRan(id, SafeCast.toUint64(block.timestamp), amount, remaining);
    }

    function getSchedule(uint256 id) external view returns (Schedule memory) {
        return _schedules[id];
    }

    // ---- Direct actions (Admin)

    function proposeRelationship(address counterparty, Role myRole, uint64 expiresAt)
        external
        onlyAdmin
        returns (uint256)
    {
        return registry.propose(counterparty, myRole, expiresAt);
    }

    function acceptRelationship(uint256 id) external onlyAdmin {
        registry.accept(id);
    }

    function rejectRelationship(uint256 id) external onlyAdmin {
        registry.reject(id);
    }

    function cancelRelationship(uint256 id) external onlyAdmin {
        registry.cancel(id);
    }

    function acceptInvite(Invite calldata invite, bytes calldata signature) external onlyAdmin returns (uint256) {
        return registry.acceptInvite(invite, signature);
    }

    function issueInvoice(uint256 relationshipId, uint128 faceValue, uint64 dueDate, bytes32 docHash)
        external
        onlyAdmin
        returns (uint256)
    {
        return invoices.issueInvoice(relationshipId, faceValue, dueDate, docHash);
    }

    function cancelInvoice(uint256 id) external onlyAdmin {
        invoices.cancelInvoice(id);
    }

    function rejectInvoice(uint256 id) external onlyAdmin {
        invoices.rejectInvoice(id);
    }

    /// @dev Approves the pool for this one NFT, then asks for the advance. The principal lands here as Hold.
    function requestAdvance(uint256 invoiceId) external nonReentrant onlyAdmin {
        invoices.approve(pool, invoiceId);
        IZalFundingPool(pool).advance(invoiceId);
    }

    /// @dev ZR-ACC-06. `periodLength` 0 selects the 30-day default. Changing a budget keeps its period and usage.
    function setBudget(uint256 budgetId, uint128 limit, uint64 periodLength) external onlyAdmin {
        if (budgetId == 0) revert InvalidBudget();
        Budget storage budget = budgets[budgetId];
        if (periodLength == 0) periodLength = DEFAULT_BUDGET_PERIOD;
        if (budget.periodLength == 0) budget.periodStart = SafeCast.toUint64(block.timestamp);
        budget.limit = limit;
        budget.periodLength = periodLength;
        emit BudgetSet(budgetId, limit, periodLength);
    }

    /// @dev ZR-ACC-07, INV-02. A Transfer leg to the zero address is rejected because USDC would revert on it.
    function setRoute(Leg[] calldata legs) external onlyAdmin {
        if (legs.length > MAX_LEGS) revert InvalidRoute();
        delete _route;
        uint256 totalBps = 0;
        for (uint256 i; i < legs.length; ++i) {
            Leg calldata leg = legs[i];
            if (leg.kind == LegKind.Transfer && leg.target == address(0)) revert InvalidRoute();
            if (leg.kind == LegKind.Vault && !factory.allowedVault(leg.target)) revert VaultNotAllowed(leg.target);
            totalBps += leg.bps;
            _route.push(leg);
        }
        if (legs.length != 0 && totalBps != BPS) revert InvalidRoute();
        emit RouteSet(legs);
    }

    function getRoute() external view returns (Leg[] memory) {
        return _route;
    }

    function vaultDeposit(address vault, uint256 amount) external nonReentrant onlyAdmin {
        if (!factory.allowedVault(vault)) revert VaultNotAllowed(vault);
        usdc.forceApprove(vault, amount);
        uint256 shares = IERC4626(vault).deposit(amount, address(this));
        emit VaultDeposited(vault, amount, shares);
    }

    /// @dev Not limited to allowed vaults, so funds can still leave a vault the owner has de-listed. The call
    /// grants no allowance and both receiver and owner are this account.
    function vaultRedeem(address vault, uint256 shares) external nonReentrant onlyAdmin {
        uint256 assets = IERC4626(vault).redeem(shares, address(this), address(this));
        emit VaultRedeemed(vault, shares, assets);
    }

    // ---- Receive route

    /// @dev ZR-ACC-08, ZR-ACC-09, INV-03. The caller has already transferred `amount` here. Nothing in this
    /// function may revert for a stored route: a seller that could make it revert could block settlement and
    /// leave the funding pool unpaid. A leg that fails keeps its funds here and emits `LegFailed`.
    /// Not `nonReentrant`, so the account can receive a settlement that its own gated op triggered (ZR-ACC-10).
    /// The only callers are ZalInvoice and ZalFundingPool, which hold their own guards.
    function receivePayment(uint256 invoiceId, uint256 amount) external {
        if (msg.sender != address(invoices) && msg.sender != pool) revert NotSettlement();

        // Read once, so nothing a leg's target does can change the route under the loop.
        Leg[] memory route = _route;
        uint256 count = route.length;
        // An empty route is reported as one Hold leg, so the leg amounts still sum to `amount`.
        uint256[] memory legAmounts = new uint256[](count == 0 ? 1 : count);
        if (count == 0) legAmounts[0] = amount;

        uint256 remaining = amount;
        for (uint256 i; i < count; ++i) {
            Leg memory leg = route[i];
            uint256 part = i == count - 1 ? remaining : amount * leg.bps / BPS;
            remaining -= part;
            legAmounts[i] = part;
            if (part == 0 || leg.kind == LegKind.Hold) continue;
            bool ok = leg.kind == LegKind.Transfer
                ? usdc.trySafeTransfer(leg.target, part)
                : _tryVaultDeposit(leg.target, part);
            if (!ok) emit LegFailed(invoiceId, i, part);
        }
        emit PaymentRouted(invoiceId, amount, legAmounts);
    }

    // ---- Internals

    function _isApprover(MemberRole role) private pure returns (bool) {
        return role == MemberRole.Approver || role == MemberRole.Admin;
    }

    function _liveOp(uint256 opId) private view returns (Op storage op) {
        if (opId == 0 || opId > opCount) revert OpNotFound(opId);
        op = _ops[opId];
        if (op.executed) revert OpAlreadyExecuted(opId);
        if (op.policyNonce != policyNonce) revert OpStale(opId);
    }

    /// @dev INV-08. `executed` is set before the call, and `_liveOp` rejects an executed op.
    function _confirm(uint256 opId, Op storage op) private {
        if (hasConfirmed[opId][msg.sender]) revert AlreadyConfirmed(opId);
        hasConfirmed[opId][msg.sender] = true;
        uint32 confirmations = ++op.confirmations;
        emit OpConfirmed(opId, msg.sender, confirmations);
        if (confirmations < requiredConfirmations(op.amount)) return;

        op.executed = true;
        // An op that collected the full threshold spends nothing from the window. A one-of-one
        // account still records its spend, but its window never blocks.
        uint8 threshold_ = threshold;
        if (confirmations < threshold_ || threshold_ == 1) _chargeWindow(opId, op.amount);
        // The target is always this account and the selector was allow-listed in `submit`.
        (bool ok, bytes memory returndata) = address(this).call(op.data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(returndata, 0x20), mload(returndata))
            }
        }
        emit OpExecuted(opId, msg.sender);
    }

    function _spentInWindow() private view returns (uint128) {
        return block.timestamp < windowStart + SPEND_WINDOW ? windowSpent : 0;
    }

    /// @dev Restarts an expired window at now. Below the threshold the charge always fits under `approvalLimit`;
    /// a one-of-one account can spend more, so its total saturates instead of reverting.
    function _chargeWindow(uint256 opId, uint256 amount) private {
        uint64 start = windowStart;
        uint256 spent = _spentInWindow();
        if (spent == 0) {
            start = SafeCast.toUint64(block.timestamp);
            windowStart = start;
        }
        uint128 charged = uint128(Math.min(amount, type(uint128).max));
        uint128 total = uint128(Math.min(spent + charged, type(uint128).max));
        windowSpent = total;
        emit SpendWindowCharged(opId, charged, total, start);
    }

    /// @dev Exact lengths, so `data` carries nothing beyond the arguments of the gated function.
    function _gatedAmount(bytes calldata data) private view returns (bytes4 selector, uint256 amount) {
        if (data.length < 4) revert OpNotAllowed();
        selector = bytes4(data[:4]);
        bytes calldata args = data[4:];
        if (selector == this.withdraw.selector && args.length == 64) {
            (, amount) = abi.decode(args, (address, uint256));
        } else if (selector == this.approveInvoice.selector && args.length == 64) {
            (uint256 invoiceId,) = abi.decode(args, (uint256, uint256));
            (amount,) = _faceAndEscrow(invoiceId);
        } else if (
            (selector == this.escrowInvoice.selector || selector == this.payInvoice.selector) && args.length == 32
        ) {
            (amount,) = _faceAndEscrow(abi.decode(args, (uint256)));
        } else if (selector == this.createSchedule.selector && args.length == 224) {
            (ScheduleKind kind,, uint256 invoiceId, uint128 perRun,,, uint32 runs) =
                abi.decode(args, (ScheduleKind, address, uint256, uint128, uint64, uint32, uint32));
            if (kind == ScheduleKind.Transfer) {
                amount = uint256(perRun) * runs;
            } else {
                (amount,) = _faceAndEscrow(invoiceId);
            }
        } else {
            revert OpNotAllowed();
        }
    }

    /// @dev From escrow when the invoice is escrowed. Otherwise ZalInvoice pulls exactly the face value.
    function _payInvoice(uint256 invoiceId) private {
        (uint128 face, uint128 escrowed) = _faceAndEscrow(invoiceId);
        if (escrowed != face) usdc.forceApprove(address(invoices), face);
        invoices.payInvoice(invoiceId);
    }

    function _faceAndEscrow(uint256 invoiceId) private view returns (uint128 face, uint128 escrowed) {
        Invoice memory inv = invoices.getInvoice(invoiceId);
        return (inv.faceValue, inv.escrowed);
    }

    function _chargeBudget(uint256 budgetId, uint256 invoiceId, uint128 amount) private {
        Budget storage budget = budgets[budgetId];
        uint64 length = budget.periodLength;
        if (length == 0) revert BudgetNotFound(budgetId);
        uint64 elapsed = SafeCast.toUint64(block.timestamp) - budget.periodStart;
        if (elapsed >= length) {
            // Periods stay aligned to the first one.
            budget.periodStart += elapsed - elapsed % length;
            budget.used = 0;
        }
        if (uint256(budget.used) + amount > budget.limit) {
            revert BudgetExceeded(budgetId, budget.used, amount, budget.limit);
        }
        uint128 used = budget.used + amount;
        budget.used = used;
        emit BudgetCharged(budgetId, invoiceId, amount, used);
    }

    /// @dev The vault was checked as an ERC-4626 over USDC when the owner allowed it. A de-listed vault counts
    /// as a failed leg, and so does a deposit that reverts or returns less than the one word of shares. A
    /// `try` would revert on that short return, and no return data is copied, so a vault cannot make this
    /// account pay for a large return either.
    function _tryVaultDeposit(address vault, uint256 amount) private returns (bool ok) {
        if (!factory.allowedVault(vault)) return false;
        usdc.forceApprove(vault, amount);
        bytes memory data = abi.encodeCall(IERC4626.deposit, (amount, address(this)));
        assembly ("memory-safe") {
            ok := call(gas(), vault, 0, add(data, 0x20), mload(data), 0, 0)
            ok := and(ok, gt(returndatasize(), 0x1f))
        }
        if (!ok) usdc.forceApprove(vault, 0);
    }
}
