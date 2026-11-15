# 0011 — Child canvases and gates keep a large canvas readable
Status: accepted

## Context
A canvas is one-for-all: one account can hold any number of counterparties, invoices, budgets, members and Split legs. Past a few dozen nodes, one flat graph stops being readable. The owner asked for a container: a child canvas, shown in its parent as a gate, that opens into a canvas with exactly the same features. It exists to limit size, not to add features.

## Decision
- **A view, not a new account.** A child canvas is an off-chain partition of the same account's graph, so nothing on-chain changes. Every node still belongs to one `CanvasAccount`. A child canvas only decides where a node is drawn.
- **Depth 1.** A canvas can have any number of child canvases, but a child canvas cannot contain another child. The limit is a constant (`MAX_CANVAS_DEPTH = 1`) so it can be raised later.
- **The Account node always stays on the root canvas.** Any other node can be moved into a child: counterparty, invoice, budget, approval, Split, vault, escrow, pool, or schedule.
- **Gate.**
  - In the parent, a child canvas is drawn as one gate node. It shows the child's name, its node count, money in and out across the boundary, and anything waiting for you inside. Opening it enters the child canvas, with a breadcrumb back to the parent.
  - Inside the child, every edge that crosses the boundary ends on a gate port at the edge of the view.
- **Gate types**, from the edges that cross the boundary:
  - *Inflow*: money enters the child (for example, from the Account into a Budget inside the child).
  - *Outflow*: money leaves the child (for example, an invoice in the child pays into the Split on the root).
  - *Link*: a relationship or reference that moves no money (for example, a counterparty in the root and its invoice in the child).
- **Creating and dissolving.** Select nodes and choose "Move to child canvas", from the node context menu or the palette's Structure group. "Dissolve" moves the nodes back to the parent. New nodes created while a child canvas is open land in that child.
- **Same features.** Palette, Inspector, Inbox, Timeline, Guided demo and minimap work identically inside a child. The Inbox counts items from every canvas.
- **Storage.** The layout is stored per chain and account: node positions, plus child canvases as `{ id, name, nodeIds }`. It lives in browser storage for now and moves to the indexer, which already owns canvas layout (ADR 0008).

## Consequences
- Large canvases stay readable without changing a contract or an event.
- The layout is presentation only, so losing it loses positions and grouping, never money or commitments. Ghost and solid still come from chain state (ADR 0003).
- The gate's money-in and money-out figures are derived from the same events as the Overview.

## Implementation notes (14 Nov 2026)
- **Code.** The layout model is in `packages/web/lib/canvas/layout.ts`. It is stored under `zal.canvas-layout.v1:<chainId>:<account>`, parsed with zod, and anything unreadable becomes an empty layout.
- **Edges.** Graph edges carry `flow: "money" | "link"`, which drives the gate port types.
- **Gate handles.** Inflow is on the left, outflow on the right, and links on the top and bottom.
- **Gate money.**
  - Money in is the Split payments and pool advances (net of fee) for the child's invoices.
  - Money out is the invoices you paid as buyer.
- **Grouping.**
  - Nodes can move to an existing child or back to the parent.
  - A new node on the root follows its neighbours into a child when they all sit in one.
  - The palette's Structure item is disabled, with its reason, when nothing groupable is selected.
- Port tooltips: "Link with X: a relationship or reference that crosses this child canvas's edge. No money moves." "Outflow to X: money leaving this child canvas." "Inflow from X: money coming into this child canvas."
- Drafts (ADR 0003 amendment) can live inside a child canvas.
- Sandbox Reset clears the sandbox chain's layout and notification keys and bumps a presentation epoch so in-memory copies reload instead of saving stale state back.
- In live mode the layout is stored by the API (`PUT /v1/accounts/:address/layout`, ADR 0012). In the sandbox it stays in browser storage.
- Positions persist. The viewport is not stored, so each load fits the view to the whole canvas. Child canvas ids are random and chosen once per edit, like draft ids, so replaying an edit after a 409 keeps the same id.
