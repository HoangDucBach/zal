"use client";

// The sandbox clock, on the canvas because moving time changes the chain (PRD principle 1): +1 day, +30 days,
// and Reset. Bots and the keeper react to each jump.

import { Button, Chip, Surface, toast } from "@heroui/react";
import { ClockCircleIcon, RestartIcon } from "@solar-icons/react/linear";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { clearPresentation } from "@/lib/canvas/presentation";
import { formatDateTime } from "@/lib/format";
import { toAppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import { SANDBOX_CHAIN_ID } from "@/lib/sandbox/config";
import {
  advanceSandboxTo,
  resetSandbox,
  useSandboxSession,
} from "@/lib/sandbox/session";

const ICON = { size: 14, "aria-hidden": true } as const;
const DAY = 86_400;

export function SandboxClock() {
  const queryClient = useQueryClient();
  const session = useSandboxSession();
  const [busy, setBusy] = useState(false);

  if (session.phase !== "ready") return null;
  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    try {
      await task();
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    } catch (error) {
      toast.danger(toAppError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Surface
      className="flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border/60 bg-surface/65 px-2 py-1 backdrop-blur-xl"
      variant="default"
    >
      <Chip color="warning" size="sm" variant="soft">
        Sandbox
      </Chip>
      <Chip size="sm" variant="secondary">
        <ClockCircleIcon {...ICON} />
        {formatDateTime(session.now)}
      </Chip>
      <Button
        isDisabled={busy}
        size="sm"
        variant="ghost"
        onPress={() => run(() => advanceSandboxTo(session.now + DAY))}
      >
        +1 day
      </Button>
      <Button
        isDisabled={busy}
        size="sm"
        variant="ghost"
        onPress={() => run(() => advanceSandboxTo(session.now + 30 * DAY))}
      >
        +30 days
      </Button>
      <Button
        isDisabled={busy}
        size="sm"
        variant="ghost"
        onPress={() =>
          run(resetSandbox).then(() => clearPresentation(SANDBOX_CHAIN_ID))
        }
      >
        <RestartIcon {...ICON} />
        Reset
      </Button>
      {session.botsBusy ? (
        <Chip color="accent" size="sm" variant="soft">
          Counterparties acting…
        </Chip>
      ) : null}
    </Surface>
  );
}
