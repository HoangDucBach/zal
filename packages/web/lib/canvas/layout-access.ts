// Who may change a canvas's saved layout (positions, child canvases, drafts, links). The canvas hides layout edits
// from anyone else and PUT /v1/accounts/:address/layout refuses them with this same table, which
// packages/indexer/lib/web-mirror copies byte for byte.

import type { MemberRole } from "./types";

/** A viewer reads the canvas and changes nothing, its layout included. */
export const LAYOUT_WRITERS = [
  "approver",
  "admin",
] as const satisfies readonly MemberRole[];

export const canWriteLayout = (role: MemberRole): boolean =>
  (LAYOUT_WRITERS as readonly MemberRole[]).includes(role);
