# PRD (draft): Zal. Payments, Invoice NFTs and receivable financing on an Avalanche L1

14 Nov 2026 · owner: wyner · status: draft

Translated from the Vietnamese draft. The product was called FlowPay in that draft and is now Zal.

## Summary
Zal is an on-chain payment network in the style of Ramp, where the whole product lives on one canvas. Every user gets the same interface. Each user programs their money flow with drag-and-drop nodes (a payment flow), and canvases connect to each other in real time. Each payment runs through the buyer's flow and the seller's flow in one transaction, on Zal's own Avalanche L1.

**Problem.** Groups, clubs and freelancers manage shared money with a treasurer and a spreadsheet. Splitting is manual and opaque. Money waiting to be spent sits idle. Sellers wait until an invoice's due date to get working capital.

**Core value, in three steps.** Programmable payments, then invoices as assets (tokenized receivables), then assets as working capital (reverse factoring). The financing model is reverse factoring, also called approved payables financing. A funder pays the seller early against an invoice the buyer has approved, and the buyer pays on the original due date.

## Design principles
These six principles drive every product decision below.

1. **Every action on the canvas.** Creating an invoice, approving, paying, requesting financing, history and the timeline are all nodes, edges or floating panels on the canvas. The app shell around it (landing page, Overview, Docs) only reads and navigates. The one exception is the invite page, where someone without a canvas creates one and accepts the invite. A row in Overview opens the canvas at its node; it never carries its own form.
2. **One canvas for every user.** The app does not split by account type. Everyone has a personal canvas with the same components. The canvas shows context-specific components on its own.
3. **Roles belong to relationships, not to people.** Seller, buyer and funder are labels on an edge that joins two canvases. The same club is the buyer towards a designer and the seller towards a sponsor.
4. **Propose, then accept.** When someone adds you to a relationship, their node shows as a ghost on your canvas. Only when you accept does the node turn solid and the edge become active. Nobody can put anything on another person's canvas without consent. Drafts never reach another canvas; connecting a draft counterparty to your Account sends the same on-chain proposal.
5. **Real time.** New proposals, acceptances, payments and balance changes appear at once on every related canvas, with no reload.
6. **Draft, ghost, solid.** A draft is placed on your own canvas but not on-chain at all: dashed accent outline, labelled Draft, visible only to you in this browser. A ghost is on-chain but not yet accepted by the other side. A solid node or edge has been signed and recorded on-chain. Users can tell what is binding from its shape.

Because roles belong to relationships, the terms below describe a person's position in one transaction, not a type of user.

## Glossary
| Term | Meaning in Zal |
|---|---|
| Seller (payee) | Issues the invoice and owns the receiving flow |
| Buyer (payer) | Approves and pays the invoice. In financing, the obligor |
| Funder (funding pool) | A USDC pool that pays sellers early |
| Liquidity provider (LP) | Deposits USDC into the funding pool |
| Invoice NFT (tokenized receivable) | A receivable tokenized as an ERC-721 |
| Approved invoice | The buyer has signed its obligation to pay |
| Escrow-backed invoice | The buyer has locked the money for the invoice, so risk is close to zero |
| Payment recipient | The current owner of the Invoice NFT. Can differ from the seller |
| Payee endpoint | The public entry point of the seller's flow |
| Payment flow | The graph of nodes and edges that decides where money goes |
| Advance | Money the pool pays the seller early |
| Advance rate | The share of invoice value advanced, usually 70 to 90% |
| Reserve | The remainder, paid to the seller once the buyer pays |
| Discount fee | The fee the pool keeps |
| Maturity (due date) | The date the buyer must pay |
| Recourse / non-recourse | Whether the seller must repay the advance if the buyer does not pay |
| Stream (flow rate) | Money moving continuously at a rate per second |

## Target users
| Role | Example | Needs |
|---|---|---|
| Seller | Freelancer, supplier, project team | Incoming money splits itself (tax, pay, savings). An advance instead of waiting for maturity |
| Buyer | Student club, small startup | Budgets per category, spend approval, payment schedules, knowing where money goes |
| Funding pool LP | Anyone depositing USDC | Finance approved invoices and earn the discount fee |

Main demo persona: a student club (buyer) pays a designer and a print shop (sellers).

## Canvas model
Each canvas is a money map: the account in the centre, counterparties around the edge, and processing nodes on the paths money takes between them.

**Four primitives.**
- **Canvas.** The workspace of one party (a person, or an organisation with several members).
- **Node.** A component on the canvas, in a ghost or solid state.
- **Edge.** A path money takes between two nodes, carrying a rule such as a percentage, a limit or a condition.
- **Relationship.** A special edge that joins your canvas to someone else's, labelled with your role in it (buyer, seller or funder). It appears on both canvases at once.
- **Child canvas.** A container for part of a large canvas (ADR 0011). In its parent it appears as a gate. Opening it shows a canvas with the same features. A canvas holds any number of nodes and counterparties, and child canvases go one level deep.

### Component catalogue
The toolbar shows only components that fit the selected node and its state, so users never pick a "buyer mode" or "seller mode".

| Component | Group | Purpose | Appears when |
|---|---|---|---|
| Account | Root | USDC balance. Start and end of every flow | Always, in the centre |
| Counterparty | Relationship | Another party on your canvas | You add them, or they propose a relationship with you |
| Payee endpoint | Relationship | Your public receiving gate | You publish your receiving flow |
| Invoice | Document | Face value, due date, status. Sits on a relationship edge | Either side creates an invoice on that edge |
| Budget | Spend control | Budget per category, monthly limit. Dropped on an issued invoice you pay, it approves the invoice against that budget | You have at least one relationship as buyer |
| Approval | Spend control | Needs M of N signatures before money moves | The canvas has two or more members |
| Schedule | Time | v1: settle an escrowed invoice at its due date, run by a keeper (ADR 0010). Pay once or recurring later | An approved, escrowed invoice you pay, and a keeper is available |
| Stream | Time | Continuous payment at a flow rate. Not supported by v1 contracts; shown disabled with that reason | Never in v1 |
| Split | Allocation | Splits incoming money by percentage | Dragged after the account or a payee endpoint |
| Escrow | Commitment | Locks money for an invoice or milestone | An approved invoice is selected |
| Vault | Yield | Puts waiting money in an ERC-4626 vault | Dragged onto any branch |
| Child canvas (Gate) | Structure | Groups selected nodes into a child canvas. In the parent it is a gate showing name, node count, money in and out, and items waiting. Gate ports are Inflow, Outflow or Link | One or more non-Account nodes are selected on the root canvas |
| Funding pool | Financing | Advance against an invoice | You are the seller of an approved invoice that is escrowed or whose buyer the pool underwrites (ADR 0009) |
| Pool liquidity | Financing | Deposit to or withdraw from the funding pool as an LP, from your wallet | Always |

### Floating panels
- **Inbox.** Holds items waiting for you and a real-time notification feed: proposal received, invoice issued to you, signature needed, payment received, advance paid, keeper settled. Unread state is kept per wallet. A new notification shows a toast and makes the Inbox glow softly until you look at it, and the sidebar shows the unread count. Clicking an item flies the canvas to its node, opening a child canvas if needed.
- **Inspector.** Details and actions for the selected node: accept, reject, pay, request an advance.
- **Timeline.** A time bar under the canvas. Drag back to see the canvas on an earlier date. Drag forward to see upcoming payments appear on edges.

### Relationship lifecycle
Two acceptances turn ghost into solid. First the proposed party accepts the relationship. Then the buyer approves the invoice. Only then does money move, directly or through the funding pool.

## App shell
- **Landing page (`/`).** What Zal does in the three steps (programmable payments, invoices as assets, assets as working capital), how the canvas works, and two calls to action: open the app, or try the sandbox.
- **App (`/app`).** A sidebar with Overview and Canvas. Its footer has Docs and a profile toolbar: wallet, network, the Sandbox switch, theme, and disconnect.
- **Overview.** Read-only: balance over time, cash in and out by week (zUSDC `Transfer` logs), money routed per Split leg (`PaymentRouted` logs), items waiting for me, invoices by status, upcoming due dates, open advances, LP position, pool utilisation and obligor credit. Each row opens the canvas at its node.
- **Docs.** Getting started, including a step-by-step guide to the sandbox demo.
- **Canvas.** Floating bars are translucent with a strong blur. Nodes have a right-click context menu. A minimap sits bottom-left. The sandbox clock (+1 day, +30 days, Reset) sits on the canvas, because moving time changes the chain. A palette on the left, grouped like the component catalogue, showing only what fits the selected node (C2). A floating tool bar at the bottom (select, pan, fit). The Inspector on the right. Inbox and Timeline as before.

## Real time and visibility
Every action between two parties appears on both canvases at once, but each side sees only its own part.

| Event | Actor's canvas | Counterparty's canvas |
|---|---|---|
| Propose relationship (A adds B as seller) | B's node as ghost, "waiting for acceptance" | A's node as ghost, pulsing gently. Inbox +1 |
| Accept relationship | B's node turns solid, the edge shows the role | A's node turns solid, the edge shows the opposite role |
| Reject relationship | B's node shows "rejected" and fades | A's node disappears |
| Issue invoice | Ghost invoice on the relationship edge | Ghost invoice on the edge, with Approve / Reject |
| Approve invoice | Invoice turns solid. Funding pool appears in the toolbar | Invoice turns solid, connected to the chosen budget |
| Advance | The invoice's last edge reroutes to the funding pool node | Invoice gets a "financed" badge. Payment recipient becomes the pool |
| Payment | Money particles run along the edges, each node's balance updates | Particles continue through their flow |

### Visibility rules
- Each person can open only their own canvas. A counterparty shows as one node and does not expose its internal flow.
- A payee endpoint is public (the buyer sees the split structure) or private (only the gate shows). On-chain the route is always readable, so private hides it in the Zal UI only.
- Only the seller, buyer and funder of an invoice see its details.
- Organisation canvases have three member roles: Admin (edits the flow), Approver (signs), Viewer (read only).
- People without an account are invited by link. Their node stays a ghost until they sign up and accept.

## Features
Fifteen user stories in six groups. P0 is required for the demo, P1 should have, P2 if time allows. Requirement IDs that implement each story are in [../architecture/requirements.md](../architecture/requirements.md).

| Code | Group | User story | Acceptance criteria | Priority |
|---|---|---|---|---|
| C1 | Canvas | As a new user, I connect my wallet and immediately see my canvas with the account node in the centre | The canvas shows the account node with its USDC balance. No account-type step | P0 |
| C2 | Canvas | As a user, I drag components from the toolbar and connect edges to build a flow | With a node selected, the palette shows what fits it; with nothing selected it offers every component as a draft to place anywhere. Edges are drawn by dragging between nodes; an invalid pair shows disabled while dragging and is refused with a reason | P0 |
| C3 | Canvas | As a user, I can tell committed from uncommitted at a glance | Ghost: dashed and faded. Solid: full line and colour. The same for every component | P0 |
| R1 | Relationship | As a user, I add a counterparty by wallet address or invite link and choose their role | The counterparty node appears as a ghost on my canvas and theirs within seconds | P0 |
| R2 | Relationship | As the proposed party, I accept or reject directly on the ghost node | Accept: solid on both canvases. Reject: the node disappears on my side | P0 |
| R3 | Relationship | As a seller, I publish a payee endpoint and choose public or private | The buyer can import the endpoint. Private mode does not reveal the internal flow in the UI | P0 |
| I1 | Invoice | As a seller, I create an invoice on a relationship edge with a face value and due date | The Invoice NFT is minted. The ghost invoice appears on both canvases | P0 |
| I2 | Invoice | As a buyer, I approve an invoice and connect it to a budget | The invoice becomes approved and solid. The budget reserves the amount | P0 |
| I3 | Invoice | As a buyer, I escrow the payment for an invoice in advance | The invoice gets an escrow-backed badge. The locked money shows on the escrow node | P1 |
| P1 | Payment | As a buyer, I pay an invoice and see the money pass through both parties' flows | One transaction. Particles run on both canvases. Balances update | P0 |
| P2 | Payment | As a seller, I split incoming money with Split and Vault | Percentages must total 100%. Each branch receives the exact amount | P0 |
| P3 | Payment | As an organisation canvas, I require 2 of 3 signatures for large payments | The payment waits at the approval node until enough signatures arrive | P1 |
| P4 | Payment | As a buyer, I set a schedule or a stream instead of paying once | The payment runs on schedule or at the flow rate | P2 |
| F1 | Financing | As a seller with an approved invoice, I get an advance from the funding pool | I receive the advance at the advance rate. The payment recipient becomes the pool. The edge reroutes on the canvas | P1 |
| S1 | Sandbox | As a visitor, I connect my wallet, turn on Sandbox, and run the whole demo alone without faucets, gas or network setup | One switch. My account is created and funded. Demo counterparties respond on their own in every role: a demo club buys from me, a demo print shop sells to me, and I can act as an LP. A guided demo panel tracks the eight demo steps. Time can be advanced, and Reset starts over. Every sandbox value is labelled sandbox | P0 |
| T1 | Timeline | As a user, I drag the timeline to see the canvas in the past and upcoming payments | Nodes and balances match the chosen date. Invoices nearing maturity are highlighted | P2 |

## Demo script
Two screens side by side: the designer's canvas on the left and the club's on the right. The audience sees every change appear on both sides at once.

1. The designer builds a receiving flow: account, then Split with 10% to a tax fund and 90% to the account. They publish the payee endpoint.
2. The designer adds the club as a counterparty with the buyer role. The club node shows as a ghost on the left. The designer node shows as a ghost on the right, with Inbox +1.
3. The club clicks Accept on the ghost node. Both nodes turn solid and the relationship edge shows the roles.
4. The designer creates a 5,000 USDC (testnet) invoice due in 30 days on the relationship edge. A ghost invoice appears on both canvases.
5. The club connects the invoice to its "Events" budget. Two members sign at the approval node and escrow 5,000 USDC. The invoice turns solid.
6. On the left, the funding pool component appears. The designer requests the advance on the invoice and receives 4,000 USDC at once (80% advance rate). In the app the designer connects the invoice to the Funding pool node, which opens the advance form. The last edge reroutes to the pool. On the right, the invoice shows a "financed" badge.
7. The timeline is dragged to the due date, and the club clicks Pay. In one transaction, money particles run from the club's budget to the pool, which keeps 4,000 plus a discount fee of 50. The 950 USDC reserve runs through the designer's Split.
8. The timeline is dragged back to show the money's whole journey, from proposal to settlement.

A live L1 cannot jump forward in time. Step 7 therefore pays early on-chain while the timeline replays the due date in the UI. The pool fixes its fee when it pays the advance, so paying early does not change the amounts (ADR 0004).

## Out of scope for the demo
- Real money and mainnet. Testnet USDC only.
- Automatic buyer credit scoring. The advance rate is fixed at 80%. Scoring is on the roadmap.
- Disputes and overdue debt. Described on a slide only.
- KYC, Vietnamese e-invoice rules, VND conversion.
- Mobile app. The canvas is designed for desktop screens.

## Open questions
Tracked with the current v1 default in [../architecture/open-questions.md](../architecture/open-questions.md).

- Can the buyer create an invoice (a purchase order) for the seller to approve, or only the seller?
- Recourse or non-recourse financing when the invoice is not escrowed?
- Is the payee endpoint public or private by default?
- How long does a ghost node live if nobody accepts it?
- Separate organisation and personal canvases, or one person switching between several?

## Terminology sources
- Request Network glossary: payee, payer, payment recipient.
- Request Network, lifecycle of a request: the buyer accepts the invoice.
- Superfluid glossary: flow, flow rate.
- Trade Finance Global, reverse factoring: approved payables financing.
- Resolve, factoring agreements: advance rate, reserve, recourse.
- Huma Finance whitepaper: receivable-backed lending pool.
