"use client";

// The Inspector for a gate: the child canvas's name, what crosses its boundary, and Open, Rename and
// Dissolve. A child canvas is a view of this account's graph, so nothing here sends a transaction.

import type { GateSummary } from "@/lib/canvas/layout";

import { Button, Card, Chip, Input } from "@heroui/react";
import {
  ArchiveUpIcon,
  CloseIcon,
  FolderOpenIcon,
} from "@solar-icons/react/linear";
import { useState } from "react";

import { Note, Row } from "./form-parts";

import { CHILD_NAME_MAX, PORT_LABELS } from "@/lib/canvas/layout";
import { Amount } from "@/components/ui/amount";

const ICON = { size: 14, "aria-hidden": true } as const;

export function GatePanel({
  gate,
  onOpen,
  onRename,
  onDissolve,
  onClose,
}: {
  readonly gate: GateSummary;
  readonly onOpen: () => void;
  readonly onRename: (name: string) => void;
  readonly onDissolve: () => void;
  readonly onClose: () => void;
}) {
  const [name, setName] = useState(gate.name);

  return (
    <Card className="w-full gap-3 border border-border bg-surface/75 p-3 shadow-md backdrop-blur-2xl">
      <Card.Header className="flex flex-row items-center justify-between gap-2 border-b border-separator pb-2">
        <Card.Title className="text-sm">Child canvas</Card.Title>
        <Button
          isIconOnly
          aria-label="Close inspector"
          size="sm"
          variant="ghost"
          onPress={onClose}
        >
          <CloseIcon {...ICON} />
        </Button>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onRename(name);
          }}
        >
          <Input
            aria-label="Child canvas name"
            className="flex-1"
            maxLength={CHILD_NAME_MAX}
            value={name}
            variant="secondary"
            onChange={(event) => setName(event.target.value)}
          />
          <Button
            isDisabled={name.trim() === "" || name.trim() === gate.name}
            size="sm"
            type="submit"
            variant="secondary"
          >
            Rename
          </Button>
        </form>
        <Row label="Nodes inside" value={gate.nodeCount} />
        <Row label="Money in" value={<Amount value={gate.moneyIn} />} />
        <Row label="Money out" value={<Amount value={gate.moneyOut} />} />
        <div className="flex flex-wrap gap-1">
          {gate.waiting > 0 ? (
            <Chip color="accent" size="sm" variant="soft">
              {gate.waiting} waiting for you
            </Chip>
          ) : null}
          {(["inflow", "outflow", "link"] as const).map((port) => (
            <Chip key={port} size="sm" variant="tertiary">
              {PORT_LABELS[port]} {gate.ports[port]}
            </Chip>
          ))}
        </div>
        <Note>Layout only · same account</Note>
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onPress={onOpen}>
            <FolderOpenIcon {...ICON} />
            Open
          </Button>
          <Button size="sm" variant="danger-soft" onPress={onDissolve}>
            <ArchiveUpIcon {...ICON} />
            Dissolve
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
