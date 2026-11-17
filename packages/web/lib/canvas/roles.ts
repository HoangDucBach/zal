// What a member role may do on a canvas (PRD "member roles"). The chain enforces the same split with
// `onlyAdmin` and `onlyApprover` on CanvasAccount; this table lets the canvas hide what the chain would refuse, and
// lets a write stop before the wallet prompt.

import type { CanvasAction } from "./palette";
import type { MemberRole } from "./types";

const RANK: Record<MemberRole, number> = {
  none: 0,
  viewer: 1,
  approver: 2,
  admin: 3,
};

export const allows = (role: MemberRole, needed: MemberRole): boolean =>
  RANK[role] >= RANK[needed];

/** CanvasAccount functions the app calls, with the role the contract checks (`onlyApprover`, else `onlyAdmin`). */
export const ROLE_FOR_CALL = {
  submit: "approver",
  confirm: "approver",
  revoke: "approver",
  cancelSchedule: "approver",
  /** Anyone may run a due schedule (ZR-SCH-05). */
  runSchedule: "none",
  proposeRelationship: "admin",
  acceptRelationship: "admin",
  rejectRelationship: "admin",
  cancelRelationship: "admin",
  acceptInvite: "admin",
  issueInvoice: "admin",
  cancelInvoice: "admin",
  rejectInvoice: "admin",
  requestAdvance: "admin",
  setRoute: "admin",
  setBudget: "admin",
  setEndpointPublic: "admin",
  setMember: "admin",
  setPolicy: "admin",
  vaultDeposit: "admin",
  vaultRedeem: "admin",
} as const satisfies Record<string, MemberRole>;

export type AccountCall = keyof typeof ROLE_FOR_CALL;

/**
 * The role a palette or connection action needs. `none`: no role on this canvas, because the action is the
 * wallet's own (pool liquidity) or creates the wallet's canvas.
 */
const ROLE_FOR_ACTION: Record<CanvasAction["kind"], MemberRole> = {
  createAccount: "none",
  provideLiquidity: "none",
  approveInvoice: "approver",
  escrow: "approver",
  schedulePayment: "approver",
  scheduleTransfer: "approver",
  proposeRelationship: "admin",
  publishEndpoint: "admin",
  issueInvoice: "admin",
  addBudget: "admin",
  setPolicy: "admin",
  setRoute: "admin",
  vaultDeposit: "admin",
  advance: "admin",
};

export const roleForAction = (action: CanvasAction): MemberRole =>
  ROLE_FOR_ACTION[action.kind];

/** The blocked reason for a role below `needed`, stated as the rule. */
export const roleReason = (needed: MemberRole): string =>
  needed === "admin" ? "Admins only" : "Approvers and admins only";
