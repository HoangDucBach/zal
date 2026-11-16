"use client";

// The Inspector for a draft: what it is, that it is not on-chain yet, and the nodes on this canvas it can connect
// to, each with what the connection would do. Connecting here is the same as dragging from its edge.

import type { Draft } from "@/lib/canvas/layout";

import { Button, Card, Chip } from "@heroui/react";
import { CloseIcon, TrashBinMinimalisticIcon } from "@solar-icons/react/linear";

import { Note } from "./form-parts";

import { CATALOGUE, DRAFT_TARGETS } from "@/lib/canvas/palette";

export interface DraftTarget {
  readonly id: string;
  readonly title: string;
  /** What connecting does, from `describeAction`. */
  readonly does: string;
}

export function DraftPanel({
  draft,
  targets,
  onConnect,
  onDelete,
  onClose,
}: {
  readonly draft: Draft;
  /** Nodes on this canvas the draft connects to now. */
  readonly targets: readonly DraftTarget[];
  readonly onConnect: (id: string) => void;
  readonly onDelete: () => void;
  readonly onClose: () => void;
}) {
  const title =
    CATALOGUE.find((c) => c.component === draft.component)?.title ?? "Draft";

  return (
    <Card
      className="w-80 gap-3 border border-dashed border-accent/60 bg-surface/75 p-3 backdrop-blur-xl"
      data-testid="draft-panel"
    >
      <Card.Header className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Card.Title className="text-sm">{title}</Card.Title>
          <Chip color="accent" size="sm" variant="soft">
            Draft
          </Chip>
        </div>
        <Button
          isIconOnly
          aria-label="Close"
          size="sm"
          variant="ghost"
          onPress={onClose}
        >
          <CloseIcon aria-hidden size={16} />
        </Button>
      </Card.Header>
      <Note>Connects to {DRAFT_TARGETS[draft.component]}</Note>
      {targets.length === 0 ? (
        <Note>No node here fits it</Note>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold">Connect to</span>
          {targets.map((target) => (
            <Button
              key={target.id}
              fullWidth
              className="h-auto justify-start py-1.5"
              size="sm"
              variant="secondary"
              onPress={() => onConnect(target.id)}
            >
              <span className="flex min-w-0 flex-col items-start">
                <span className="text-sm">{target.title}</span>
                <span className="text-xs text-muted">{target.does}</span>
              </span>
            </Button>
          ))}
        </div>
      )}
      <Button size="sm" variant="danger-soft" onPress={onDelete}>
        <TrashBinMinimalisticIcon aria-hidden size={14} />
        Delete draft
      </Button>
    </Card>
  );
}
