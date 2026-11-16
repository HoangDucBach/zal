"use client";

// The Inbox (PRD "Proposal inbox", ADR 0011): ghost nodes waiting for you on any canvas level, and the notification
// feed. It carries the accent, and glows softly when something new arrives until you look at it.

import type { CanvasGraph, CanvasNodeData } from "@/lib/canvas/graph";
import type {
  InboxDetails,
  NotificationKind,
} from "@/lib/canvas/notifications";

import {
  Badge,
  Button,
  Card,
  Chip,
  ScrollShadow,
  Separator,
  Tooltip,
} from "@heroui/react";
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
import { Amount, AmountsInText } from "@/components/ui/amount";
import { CopyButton, shortHex } from "@/components/ui/copy-button";
import { NOTIFICATION_LABEL, inboxDetails } from "@/lib/canvas/notifications";
import { formatDate, formatDateTime } from "@/lib/format";

const ICON = { size: 14, "aria-hidden": true } as const;

const KIND_ICON: Record<NotificationKind, React.ReactNode> = {
  proposalReceived: <UserRoundedIcon {...ICON} />,
  invoiceIssued: <BillListIcon {...ICON} />,
  signatureNeeded: <PenNewSquareIcon {...ICON} />,
  paymentReceived: <WalletMoneyIcon {...ICON} />,
  advancePaid: <HandMoneyIcon {...ICON} />,
  scheduleRan: <ClockCircleIcon {...ICON} />,
};

const describe = (data: CanvasNodeData | undefined): string => {
  if (data?.kind === "counterparty")
    return `${data.label ?? "A counterparty"} proposed a relationship`;
  if (data?.kind === "invoice")
    return `Invoice #${data.invoice.id} needs your approval`;

  return "Waiting for you";
};

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-1">{children}</span>
    </div>
  );
}

/** The hover card on an inbox item: everything the one-line row truncates, and what it needs from you. */
function DetailsCard({
  kind,
  title,
  text,
  timestamp,
  details,
}: {
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly timestamp?: number;
  readonly details: InboxDetails;
}) {
  const {
    counterparty,
    counterpartyLabel,
    amount,
    invoiceId,
    dueDate,
    action,
  } = details;

  return (
    <div className="flex w-64 flex-col gap-1.5 p-1 text-xs">
      <span className="text-muted">{kind}</span>
      <span className="text-sm font-semibold">{title}</span>
      {text === undefined ? null : (
        <span className="text-muted">
          <AmountsInText text={text} />
        </span>
      )}
      <Separator />
      {counterparty === undefined ? null : (
        <Row label="Counterparty">
          {counterpartyLabel ?? shortHex(counterparty)}
          <CopyButton label="Copy counterparty address" value={counterparty} />
        </Row>
      )}
      {amount === undefined ? null : (
        <Row label="Amount">
          <Amount value={amount} />
        </Row>
      )}
      {invoiceId === undefined ? null : (
        <Row label="Invoice">#{invoiceId.toString()}</Row>
      )}
      {dueDate === undefined ? null : (
        <Row label="Due">{formatDate(dueDate)}</Row>
      )}
      {timestamp === undefined ? null : (
        <Row label="Time">{formatDateTime(timestamp)}</Row>
      )}
      <Row label="Needs">
        <span className={action === "None" ? "text-muted" : "text-accent"}>
          {action}
        </span>
      </Row>
    </div>
  );
}

/** Hover or focus shows the details; the content stays open while hovered, so its copy button is reachable. */
function WithDetails({
  card,
  children,
}: {
  readonly card: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip closeDelay={200} delay={300}>
      {children}
      <Tooltip.Content placement="left">{card}</Tooltip.Content>
    </Tooltip>
  );
}

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
              {graph.inbox.map((id) => {
                const data = graph.nodes.find((n) => n.id === id)?.data;

                return (
                  <WithDetails
                    key={id}
                    card={
                      <DetailsCard
                        details={inboxDetails(undefined, data)}
                        kind="Waiting for you"
                        title={describe(data)}
                      />
                    }
                  >
                    <Button
                      className="justify-start"
                      size="sm"
                      variant="secondary"
                      onPress={() => onOpen(id)}
                    >
                      <span className="truncate">{describe(data)}</span>
                    </Button>
                  </WithDetails>
                );
              })}
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
                      <WithDetails
                        card={
                          <DetailsCard
                            details={inboxDetails(
                              n.kind,
                              graph.nodes.find((node) => node.id === n.nodeId)
                                ?.data,
                            )}
                            kind={NOTIFICATION_LABEL[n.kind]}
                            text={n.detail}
                            timestamp={n.timestamp}
                            title={n.title}
                          />
                        }
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
                      </WithDetails>
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
