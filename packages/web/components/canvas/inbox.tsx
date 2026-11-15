"use client";

// The Inbox (PRD "Proposal inbox", ADR 0011): ghost nodes waiting for you on any canvas level, and the notification
// feed. It carries the accent, and glows softly when something new arrives until you look at it.

import type { CanvasGraph, CanvasNodeData } from "@/lib/canvas/graph";
import type { NotificationKind } from "@/lib/canvas/notifications";

import { Badge, Button, Card, Chip, ScrollShadow } from "@heroui/react";
import {
  BillListIcon,
  CheckReadIcon,
  HandMoneyIcon,
  InboxIcon,
  PenNewSquareIcon,
  ClockCircleIcon,
  UserRoundedIcon,
  WalletMoneyIcon,
} from "@solar-icons/react/linear";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { useNotifications } from "@/components/shell/notifications";
import { AmountsInText } from "@/components/ui/amount";
import { formatDate } from "@/lib/format";

const ICON = { size: 14, "aria-hidden": true } as const;

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  proposalReceived: <UserRoundedIcon {...ICON} />,
  invoiceIssued: <BillListIcon {...ICON} />,
  signatureNeeded: <PenNewSquareIcon {...ICON} />,
  paymentReceived: <WalletMoneyIcon {...ICON} />,
  advancePaid: <HandMoneyIcon {...ICON} />,
  keeperSettled: <ClockCircleIcon {...ICON} />,
};

const describe = (data: CanvasNodeData | undefined): string => {
  if (data?.kind === "counterparty")
    return `${data.label ?? "A counterparty"} proposed a relationship`;
  if (data?.kind === "invoice")
    return `Invoice #${data.invoice.id} needs your approval`;

  return "Waiting for you";
};

export function Inbox({
  graph,
  onOpen,
}: {
  readonly graph: CanvasGraph;
  /** Flies to a node, switching canvas level when it sits in another one. */
  readonly onOpen: (id: string) => void;
}) {
  const {
    feed,
    isRead,
    unreadCount,
    fresh,
    acknowledge,
    markRead,
    markAllRead,
  } = useNotifications();
  const reduceMotion = useReducedMotion();
  const glowing = fresh && reduceMotion !== true;

  return (
    <div
      className="relative isolate"
      data-glowing={glowing ? "true" : "false"}
      data-testid="inbox"
      onFocus={acknowledge}
      onPointerEnter={acknowledge}
    >
      <AnimatePresence>
        {glowing ? (
          <motion.div
            key="glow"
            aria-hidden
            animate={{ opacity: [0.35, 1], scale: [0.98, 1.03] }}
            className="pointer-events-none absolute -inset-3 -z-10 rounded-4xl bg-radial from-accent/60 from-60% via-accent/30 via-80% to-transparent"
            exit={{ opacity: 0, transition: { duration: 0.3 } }}
            initial={{ opacity: 0 }}
            transition={{
              duration: 0.4,
              ease: "easeOut",
              repeat: Infinity,
              repeatType: "reverse",
              repeatDelay: 0.8,
            }}
          />
        ) : null}
      </AnimatePresence>
      <Card className="w-80 gap-2 border border-accent/40 bg-linear-to-b from-accent/20 via-surface/70 to-surface/70 p-3 backdrop-blur-2xl">
        <Card.Header className="flex flex-row items-center gap-2">
          <Badge.Anchor>
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent/20 text-accent">
              <InboxIcon aria-hidden size={16} />
            </span>
            {unreadCount > 0 ? (
              <Badge color="accent" size="sm">
                {unreadCount}
              </Badge>
            ) : null}
          </Badge.Anchor>
          <Card.Title className="text-sm">Inbox</Card.Title>
          <Chip
            color={graph.inbox.length > 0 ? "accent" : "default"}
            size="sm"
            variant="soft"
          >
            {graph.inbox.length} waiting
          </Chip>
          <span className="flex-1" />
          {unreadCount > 0 ? (
            <Button size="sm" variant="ghost" onPress={markAllRead}>
              <CheckReadIcon {...ICON} />
              Mark all read
            </Button>
          ) : null}
        </Card.Header>
        <Card.Content className="flex flex-col gap-2">
          {graph.inbox.length === 0 ? null : (
            <div className="flex flex-col gap-1">
              {graph.inbox.map((id) => (
                <Button
                  key={id}
                  className="justify-start"
                  size="sm"
                  variant="secondary"
                  onPress={() => onOpen(id)}
                >
                  {describe(graph.nodes.find((n) => n.id === id)?.data)}
                </Button>
              ))}
            </div>
          )}
          {feed.length === 0 ? (
            <span className="text-xs text-muted">Nothing new</span>
          ) : (
            <ScrollShadow className="flex max-h-56 flex-col gap-1 overflow-y-auto">
              <AnimatePresence initial={false}>
                {feed.map((n) => {
                  const unread = !isRead(n.key);

                  return (
                    <motion.div
                      key={n.key}
                      animate={{ opacity: 1, y: 0 }}
                      initial={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.25 }}
                    >
                      <Button
                        fullWidth
                        aria-label={`${n.title}${unread ? ", unread" : ""}`}
                        className="h-auto items-start justify-start gap-2 py-1.5 text-start"
                        size="sm"
                        variant="ghost"
                        onPress={() => {
                          markRead(n.key);
                          onOpen(n.nodeId);
                        }}
                      >
                        <span
                          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md ${unread ? "bg-accent/20 text-accent" : "bg-default text-muted"}`}
                        >
                          {KIND_ICON[n.kind]}
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span
                            className={`truncate text-xs ${unread ? "font-semibold" : "text-muted"}`}
                          >
                            {n.title}
                          </span>
                          <span className="truncate text-xs text-muted">
                            {formatDate(n.timestamp)} ·{" "}
                            <AmountsInText text={n.detail} />
                          </span>
                        </span>
                        {unread ? (
                          <span
                            aria-hidden
                            className="mt-1.5 size-2 shrink-0 rounded-full bg-accent"
                          />
                        ) : null}
                      </Button>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </ScrollShadow>
          )}
        </Card.Content>
      </Card>
    </div>
  );
}
