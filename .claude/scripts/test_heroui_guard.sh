#!/usr/bin/env bash
# Feeds hook events to heroui_cli_guard.py and checks each verdict. Run from the repo root.
set -u
export CLAUDE_PROJECT_DIR="$PWD"
HOOK=.claude/hooks/heroui_cli_guard.py
SID="selftest-$$"
W=packages/web/app/x.tsx
fail=0
expect() { # expect <exit> <mode> <label> <json>
  printf '%s' "$4" | python3 "$HOOK" "$2" >/dev/null 2>&1
  local got=$?
  if [ "$got" = "$1" ]; then echo "ok   $3"; else echo "FAIL $3 (exit $got, want $1)"; fail=1; fi
}
ev() { printf '{"session_id":"%s","tool_name":"%s","tool_input":%s}' "$SID" "$1" "$2"; }
expect 2 check "unread component blocked" "$(ev Write '{"file_path":"'$W'","content":"import { Card } from \"@heroui/react\";"}')"
expect 0 record "cli lookup recorded" "$(ev Bash '{"command":"pnpm --filter @zal/web exec heroui doc card"}')"
expect 0 check "component after lookup" "$(ev Write '{"file_path":"'$W'","content":"import { Card } from \"@heroui/react\";"}')"
expect 2 check "raw-colour gradient" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"bg-linear-to-b from-pink-500 to-transparent\" />"}')"
expect 0 check "token gradient" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"bg-linear-to-b from-accent/20 via-surface to-transparent\" />"}')"
expect 0 check "gradient stop position" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"bg-radial from-accent/10 from-10% to-transparent\" />"}')"
expect 2 check "conic gradient" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"bg-conic from-accent\" />"}')"
expect 0 check "light backdrop blur" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"backdrop-blur-md\" />"}')"
expect 0 check "strong panel blur" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"bg-surface/70 backdrop-blur-2xl\" />"}')"
expect 0 check "second icon set allowed" "$(ev Edit '{"file_path":"'$W'","new_string":"import { Gear } from \"@gravity-ui/icons\";"}')"
expect 2 check "third icon set" "$(ev Edit '{"file_path":"'$W'","new_string":"import { Home } from \"lucide-react\";"}')"
expect 0 check "solar icons" "$(ev Edit '{"file_path":"'$W'","new_string":"import { GripIcon } from \"@solar-icons/react\";"}')"
expect 2 check "heavy blur" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"backdrop-blur-3xl\" />"}')"
expect 2 check "arbitrary value class" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"w-[320px]\" />"}')"
expect 2 check "inline style" "$(ev Edit '{"file_path":"'$W'","new_string":"<div style={{color:1}} />"}')"
expect 0 check "plain layout classes" "$(ev Edit '{"file_path":"'$W'","new_string":"<div className=\"flex h-full gap-2\" />"}')"
expect 2 check "extra css file" "$(ev Write '{"file_path":"packages/web/styles/canvas.css","content":"a{}"}')"
expect 2 check "xyflow override" "$(ev Edit '{"file_path":"packages/web/styles/globals.css","new_string":".react-flow__node{}"}')"
expect 2 check "heroui via package manager" "$(ev Bash '{"command":"pnpm --filter @zal/web add @heroui/react@latest"}')"
expect 0 check "other package install" "$(ev Bash '{"command":"pnpm --filter @zal/web add @xyflow/react"}')"
expect 0 check "outside web untouched" "$(ev Write '{"file_path":"packages/contracts/src/A.sol","content":"style={{"}')"
expect 2 check "chained heroui install" "$(ev Bash '{"command":"cd packages/web && pnpm add @heroui/styles"}')"
expect 0 check "heroui mentioned in text" "$(ev Bash '{"command":"cat > a.md <<X\n- The hook blocks `pnpm add @heroui/*`.\nX"}')"
rm -f ".claude/.state/heroui-$SID.txt"
exit $fail
