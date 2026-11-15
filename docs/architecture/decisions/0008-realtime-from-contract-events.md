# 0008 — Real time comes from our own contract-event watching, not AvaCloud
Status: accepted

## Context
Both canvases must update within seconds of a contract event (PRD principle 5). We checked AvaCloud on 14 Nov 2026. Webhooks are enabled only for a listed set of L1s, which does not include ours, and offer only `address_activity` events, not topic-filtered contract logs (developers.avacloud.io/webhooks-api/supported-chains, /webhooks-api/overview). The Data API serves an L1 only if it is listed on the Avalanche Explorer (developers.avacloud.io/data-api/overview). The Avalanche SDK is a beta developer preview, and its docs show no custom-L1 chain configuration (developers.avacloud.io/avalanche-sdk/overview).

## Decision
The web client uses wagmi and viem directly, as Zalax does. It watches contract events (`watchContractEvent`) and invalidates the matching TanStack queries. The planned `packages/indexer` serves history, the timeline replay and canvas layout, and pushes over a websocket. It does not stand between a user and the chain for reads that matter.

## Consequences
- No third-party API key in the client and no dependency on an L1 listing.
- Revisit AvaCloud when the L1 is listed on the Explorer or Webhooks add it. The Data API could then replace the indexer's balance and history endpoints.

- Until the indexer exists, the client polls logs every second, because the L1 RPC has no websocket endpoint yet.
- 15 Nov 2026: with the indexer in place (ADR 0012), live mode uses the SSE stream. Chain polling is now only the fallback, and the canvas shows "Live updates paused" when it is in use.
