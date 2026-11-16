"use client";

// Live mode's quiet status on the canvas: the one-line sign-in prompt when an edit is waiting to be saved, why a
// layout edit was not saved or not applied, and "live updates paused" while the API stream is down and the page
// polls the chain instead (ADR 0012).

import type { LayoutPersistence } from "@/hooks/use-canvas-layout";

import { Button, Chip, Surface } from "@heroui/react";

import { useLiveStatus } from "@/hooks/use-live-updates";

export function LiveBar({
  persistence,
}: {
  readonly persistence: LayoutPersistence;
}) {
  const live = useLiveStatus();

  const notSaved =
    persistence.kind === "refused" || persistence.kind === "rejected"
      ? persistence
      : undefined;

  if (live === "off" && persistence.kind !== "signIn" && notSaved === undefined)
    return null;

  return (
    <div className="flex max-w-full flex-col items-center gap-2">
      {live === "polling" ? (
        <Chip data-testid="live-paused" size="sm" variant="secondary">
          Live updates paused · polling the chain
        </Chip>
      ) : null}
      {persistence.kind === "signIn" ? (
        <Surface
          className="flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-accent/40 bg-surface/70 py-1 pr-1 pl-3 backdrop-blur-xl"
          data-testid="layout-sign-in"
          variant="default"
        >
          <span className="text-xs">
            Layout not saved · one signature, no gas
          </span>
          <Button size="sm" variant="primary" onPress={persistence.signIn}>
            Sign in to save
          </Button>
        </Surface>
      ) : null}
      {notSaved === undefined ? null : (
        <Chip
          color="danger"
          data-testid="layout-not-saved"
          size="sm"
          variant="soft"
        >
          {notSaved.kind === "refused"
            ? "Layout not saved"
            : "Edit not applied"}{" "}
          · {notSaved.reason}
        </Chip>
      )}
    </div>
  );
}
