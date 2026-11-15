# 0006 — HeroUI through its CLI, default look, xyflow defaults
Status: accepted

## Context
Models remember HeroUI v2, but Zal uses v3, whose API differs. Hand-made styling drifts into a generic "AI" look and fights the theme. The canvas uses xyflow.

## Decision
The web package is scaffolded with `heroui init`. Every component is looked up through `heroui doc` or `heroui info` (or the HeroUI MCP server) before use. HeroUI is installed and upgraded with `heroui install` and `heroui upgrade`. The look is the HeroUI theme from the theme builder plus a 14px base. xyflow keeps its default stylesheet, and its color mode follows the app theme. `.claude/hooks/heroui_cli_guard.py` enforces these rules, and `.claude/scripts/test_heroui_guard.sh` tests the hook.

## Consequences
- UI code stays close to HeroUI's own examples, and upgrades follow the CLI's migration path.
- A visual need HeroUI cannot meet is a design discussion, not a CSS patch.

## Amendment (14 Nov 2026)
The owner asked for more depth than flat defaults: simple gradients like the reference designs, a 3D globe with animated transfers on the landing page, and an Overview with charts. Allowed now:
- Linear or radial gradients whose colour stops are HeroUI theme tokens only. A theme change still recolours them.
- `backdrop-blur-sm` and `md`.
- A WebGL scene in the landing hero only.

Raw palette colours, arbitrary values, inline styles, extra CSS files and xyflow overrides stay blocked. The hook and `.claude/scripts/test_heroui_guard.sh` encode the new rule.
