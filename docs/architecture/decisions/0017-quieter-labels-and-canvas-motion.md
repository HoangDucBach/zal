# 0017 — One testnet label, structured nodes, looping canvas animations
Status: accepted (16 Nov 2026). Amends ADR 0006 and rule 8 of `AGENTS.md`.

## Context
Testing the live app, the owner found the canvas noisy and hard to read:
- "testnet" and "simulated" chips sat next to every amount and on the Vault, and "on-chain/off-chain" tags on drafts.
- Nodes squeezed facts into one line joined by "·" and truncated them.
- Nothing marked the Account node as the root of every flow, and a selected edge was hard to follow.

ADR 0006 allowed loops only for the notification glow and the Timeline marquee. AGENTS.md rule 8 and ZR-VLT-01 asked for a testnet or simulated label in every UI.

## Decision
- **One testnet label.** The app shell shows a single "testnet" badge next to the product name, and Docs say that zUSDC is testnet money and vault yield is simulated. Amounts, forms, nodes and the Vault carry no "testnet", "simulated" or "on-chain" words.
- **Structured nodes.** A node card has a muted kind label, a title, and key–value rows. Facts are not joined with "·", and key values are not truncated. Ghost and solid stay visually distinct (ADR 0003).
- **Two more looping animations**, built with `motion` and SVG (no CSS files, no inline styles), and off under `prefers-reduced-motion`:
  - A selected edge shows a light running along a solid line in the accent colour.
  - The Account node and the wallet popover's canvas card sit on an aurora: a dark background lit by soft lights derived from the primary colour (hue-turned for purple and blue) that chase each other around the edge of a dark card, bending at the corners and cross-fading between hues, plus film grain. Both use a scoped dark theme, so their text stays light in either app theme. The Account details sit on a frosted panel over it.
- **Account node holds its own details.** Balance, role, policy, members, add approver and the mint button live in the Account node card instead of the side Inspector.
- **One Split per canvas** in the palette, matching the one route stored by `CanvasAccount`.

## Consequences
- Fewer labels per screen. Someone who misses the sidebar badge learns that zUSDC is testnet money from Docs and the landing page, not from each amount.
- ZR-VLT-01 and rule 8 change wording. The vault stays simulated on-chain; only where the label appears changes.
- The custom edge and the Account node depart from xyflow's default look. Other nodes keep HeroUI components, and the hook still blocks raw colours, arbitrary values and CSS files.
- PRD §7 (screens and UI rules) needs the same change.
