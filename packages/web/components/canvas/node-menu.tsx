"use client";

// The node context menu (right click): a HeroUI Dropdown anchored to the node itself, with the actions that fit
// that node and their keyboard shortcuts.

import { Dropdown, Kbd, Label, Separator } from "@heroui/react";
import { useMemo } from "react";

export type MenuActionId =
  | "inspect"
  | "focus"
  | "copy"
  | "group"
  | "ungroup"
  | "open"
  | "dissolve"
  | "goto"
  | "delete"
  | `move:${string}`;

export interface MenuAction {
  readonly id: MenuActionId;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly shortcut?: {
    readonly command?: boolean;
    readonly shift?: boolean;
    readonly key: string;
  };
  readonly danger?: boolean;
  /** Starts a new section with a separator above it. */
  readonly section?: boolean;
}

export function NodeMenu({
  anchor,
  actions,
  onAction,
  onClose,
}: {
  /** The node element the menu opens next to; `undefined` closes it. */
  readonly anchor: Element | undefined;
  readonly actions: readonly MenuAction[];
  readonly onAction: (id: MenuActionId) => void;
  readonly onClose: () => void;
}) {
  const triggerRef = useMemo(() => ({ current: anchor ?? null }), [anchor]);

  return (
    <Dropdown
      isOpen={anchor !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dropdown.Trigger aria-label="Node actions" className="sr-only" />
      <Dropdown.Popover
        className="min-w-56 border border-border bg-overlay/80 backdrop-blur-xl"
        placement="bottom start"
        triggerRef={triggerRef}
      >
        <Dropdown.Menu
          aria-label="Node actions"
          onAction={(key) => {
            onAction(String(key) as MenuActionId);
            onClose();
          }}
        >
          {actions.flatMap((action, index) => [
            ...(action.section && index > 0
              ? [<Separator key={`sep-${action.id}`} />]
              : []),
            <Dropdown.Item
              key={action.id}
              id={action.id}
              textValue={action.label}
              variant={action.danger ? "danger" : "default"}
            >
              <span className="text-muted">{action.icon}</span>
              <Label>{action.label}</Label>
              {action.shortcut === undefined ? null : (
                <Kbd className="ms-auto" slot="keyboard" variant="light">
                  {action.shortcut.command ? (
                    <Kbd.Abbr keyValue="command" />
                  ) : null}
                  {action.shortcut.shift ? <Kbd.Abbr keyValue="shift" /> : null}
                  <Kbd.Content>{action.shortcut.key}</Kbd.Content>
                </Kbd>
              )}
            </Dropdown.Item>,
          ])}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
