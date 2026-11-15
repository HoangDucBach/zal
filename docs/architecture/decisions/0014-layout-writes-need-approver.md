# 0014 — Only approvers and admins write a canvas's layout
Status: accepted (15 Nov 2026, coordinator default under owner autonomy)

## Context
The layout of a canvas (positions, child canvases, drafts) is shared by every member in live mode. Viewers are read-only by the PRD's member roles. The API allowed any member, including a Viewer, to replace the layout; an independent review proved a Viewer could wipe the layout every member loads.

## Decision
One rule, in `packages/web/lib/canvas/layout-access.ts` and mirrored byte for byte in `packages/indexer/lib/web-mirror/layout-access.ts` (a drift test fails on any difference): Approvers and Admins write the layout, Viewers do not. The API answers 403 to a Viewer; the canvas hides layout edits from Viewers. The wallet's own not-yet-created canvas is editable locally.

## Consequences
- A Viewer cannot change what other members see.
- Changing who may edit layout is one edit in one file plus its mirror.
