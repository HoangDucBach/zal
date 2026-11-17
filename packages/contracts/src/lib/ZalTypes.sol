// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

/// @dev Admin can also approve.
enum MemberRole {
    None,
    Viewer,
    Approver,
    Admin
}

/// @dev A party's role in one relationship. Nothing on-chain records a role against an account itself.
enum Role {
    Buyer,
    Seller
}

enum RelStatus {
    None,
    Proposed,
    Active,
    Rejected,
    Cancelled
}

enum InvoiceStatus {
    None,
    Issued,
    Approved,
    Paid,
    Rejected,
    Cancelled
}

enum LegKind {
    Hold,
    Transfer,
    Vault
}

struct Relationship {
    address buyer;
    address seller;
    address proposer;
    uint64 proposedAt;
    /// @dev 0 means the proposal never expires.
    uint64 expiresAt;
    RelStatus status;
}

struct Invoice {
    uint256 relationshipId;
    address seller;
    address buyer;
    uint128 faceValue;
    /// @dev 0 or `faceValue`. Reset to 0 when the invoice is paid, because the escrow has left the contract.
    uint128 escrowed;
    uint64 issuedAt;
    uint64 dueDate;
    uint64 approvedAt;
    InvoiceStatus status;
    bytes32 docHash;
}

/// @dev One branch of a Split. `target` is ignored for Hold, the recipient for Transfer, an ERC-4626 vault for Vault.
struct Leg {
    LegKind kind;
    address target;
    uint16 bps;
}

struct Budget {
    uint128 limit;
    uint128 used;
    uint64 periodStart;
    uint64 periodLength;
}

enum ScheduleKind {
    Transfer,
    PayInvoice
}

/// @dev A payment a CanvasAccount approved ahead of time. A schedule is `active` exactly while it
/// has runs left and has not been cancelled.
struct Schedule {
    ScheduleKind kind;
    /// @dev Transfer only. Zero for PayInvoice.
    address recipient;
    /// @dev PayInvoice only. Zero for Transfer.
    uint256 invoiceId;
    /// @dev Transfer: paid on every run. PayInvoice: the invoice's face value.
    uint128 amount;
    /// @dev The time from which the next run is allowed.
    uint64 nextAt;
    /// @dev Seconds between runs. 0 for a schedule that runs once.
    uint32 interval;
    uint32 remaining;
    bool active;
}

struct Advance {
    address seller;
    uint128 principal;
    uint128 fee;
    uint64 fundedAt;
    /// @dev True when the invoice was not escrowed at funding, so the principal counts against the buyer's
    /// obligor limit until repayment (INV-10).
    bool onCredit;
}

/// @dev Off-chain EIP-712 invite. `inviteeEmailHash` is not checked on-chain.
struct Invite {
    address proposer;
    Role proposerRole;
    bytes32 inviteeEmailHash;
    uint256 nonce;
    uint64 deadline;
}
