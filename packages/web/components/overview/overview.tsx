"use client";

// Overview (PRD "App shell"): read-only. Balances, money in and out, the Split, what waits for me, invoices by
// status, upcoming due dates, the pool and buyer credit. Every row opens the canvas at its node; nothing here sends a
// transaction (PRD principle 1). Every number is read from the chain through useCanvasView.

import type { CanvasGraph } from "@/lib/canvas/graph";
import type { CanvasState, Invoice, InvoiceStatus } from "@/lib/canvas/types";
import type { BalancePoint } from "@/lib/overview/metrics";
import type { Part, Tone } from "./charts";

import {
  BillListLinearIcon,
  CalendarLinearIcon,
  DatabaseLinearIcon,
  DollarLinearIcon,
  GraphUpLinearIcon,
  InboxLinearIcon,
  RoutingLinearIcon,
  ShieldCheckLinearIcon,
  TransferHorizontalLinearIcon,
} from "@solar-icons/react";
import {
  Alert,
  Card,
  Chip,
  Label,
  Link,
  Meter,
  Spinner,
  Table,
} from "@heroui/react";
import clsx from "clsx";
import { useState } from "react";
import { isAddressEqual, type Address } from "viem";

import { BalanceChart, SegmentBar, Swatch, WeekBars } from "./charts";

import { useCanvasView } from "@/hooks/use-canvas-view";
import { useAppHref } from "@/hooks/use-selected-account";
import { isFunded, nodeId } from "@/lib/canvas/graph";
import { Amount, Bps, amountText } from "@/components/ui/amount";
import { formatDate, formatDaysFrom, shortAddress } from "@/lib/format";
import {
  STATUS_ORDER,
  balanceSeries,
  dailyBalance,
  invoicesByStatus,
  obligorCredit,
  openAdvances,
  poolUse,
  routedByLeg,
  upcomingDue,
  weeklyFlows,
} from "@/lib/overview/metrics";

const ICON = { width: 16, height: 16, "aria-hidden": true } as const;
const WEEKS = 8;
const DAY = 86_400;

const STATUS_COLOR: Record<
  InvoiceStatus,
  "default" | "accent" | "success" | "danger"
> = {
  none: "default",
  issued: "default",
  approved: "accent",
  paid: "success",
  rejected: "danger",
  cancelled: "danger",
};
/** Status colours: neutral while waiting, the accent once approved, the reserved status hues after. */
const STATUS_TONE: Record<InvoiceStatus, Tone> = {
  none: "neutral",
  issued: "ink",
  approved: "accent",
  paid: "success",
  rejected: "danger",
  cancelled: "danger-soft",
};
/** Split legs, in route order. A Split has a handful of legs; past three they fold to the neutral ink. */
const LEG_TONES: readonly Tone[] = ["accent", "ink", "accent-soft", "ink-soft"];
const legTone = (index: number): Tone =>
  LEG_TONES[Math.min(index, LEG_TONES.length - 1)] ?? "neutral";

function nameOf(state: CanvasState, address: Address): string {
  if (isAddressEqual(address, state.account.address)) return "You";

  return state.labels[address] ?? shortAddress(address);
}

function counterpartyOf(state: CanvasState, invoice: Invoice): string {
  const mine = isAddressEqual(invoice.seller, state.account.address);

  return nameOf(state, mine ? invoice.buyer : invoice.seller);
}

/** A dashboard card: icon and title, an optional figure, then the body. One quiet gradient per card. */
function Tile({
  icon,
  title,
  aside,
  className,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly aside?: React.ReactNode;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Card
      className={clsx(
        "gap-3 p-4",
        className ?? "bg-linear-to-b from-surface-secondary/60 to-surface",
      )}
    >
      <Card.Header className="flex flex-row items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-full bg-default text-muted">
          {icon}
        </span>
        <Card.Title className="text-sm">{title}</Card.Title>
        {aside === undefined ? null : <div className="ml-auto">{aside}</div>}
      </Card.Header>
      <Card.Content className="flex flex-1 flex-col gap-3">
        {children}
      </Card.Content>
    </Card>
  );
}

/** A card's headline: an `Amount` at `size="figure"`, or a count. */
function Figure({
  value,
  note,
}: {
  readonly value: React.ReactNode;
  readonly note?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {value}
      {note === undefined ? null : (
        <span className="text-xs text-muted">{note}</span>
      )}
    </div>
  );
}

function Empty({
  children,
  href,
  action,
}: {
  readonly children: React.ReactNode;
  readonly href?: string;
  readonly action?: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-start justify-center gap-1 rounded-lg border border-dashed border-separator p-3">
      <span className="text-xs text-muted">{children}</span>
      {href === undefined ? null : (
        <Link className="text-xs" href={href}>
          {action}
        </Link>
      )}
    </div>
  );
}

function BalanceCard({ state }: { readonly state: CanvasState }) {
  const points = balanceSeries(state);
  const [shown, setShown] = useState<BalancePoint | undefined>(undefined);
  const weekAgo = [...points]
    .reverse()
    .find((p) => p.timestamp <= state.now - 7 * DAY);
  const delta =
    weekAgo === undefined ? undefined : state.account.balance - weekAgo.balance;

  return (
    <Tile
      aside={
        delta === undefined || delta === 0n ? null : (
          <Chip
            color={delta > 0n ? "success" : "danger"}
            size="sm"
            variant="soft"
          >
            <Amount signed precision="cents" unit={null} value={delta} /> in 7
            days
          </Chip>
        )
      }
      className="bg-linear-to-br from-accent/15 via-surface to-surface lg:col-span-2"
      icon={<GraphUpLinearIcon {...ICON} />}
      title="Account balance"
    >
      <div className="flex flex-col gap-0.5">
        <Amount
          precision="cents"
          size="hero"
          unit="testnet USDC"
          value={shown?.balance ?? state.account.balance}
        />
        <span className="text-xs text-muted">
          {shown === undefined
            ? `In your canvas now · ${state.cash.length} movement${state.cash.length === 1 ? "" : "s"} on chain`
            : `Balance on ${formatDate(shown.timestamp)}`}
        </span>
      </div>
      <BalanceChart points={dailyBalance(state)} onActive={setShown} />
    </Tile>
  );
}

function CashCard({ state }: { readonly state: CanvasState }) {
  const weeks = weeklyFlows(state, WEEKS);
  const [hover, setHover] = useState<number | undefined>(undefined);
  const scope = hover === undefined ? weeks : weeks.slice(hover, hover + 1);
  const incoming = scope.reduce((sum, w) => sum + w.incoming, 0n);
  const outgoing = scope.reduce((sum, w) => sum + w.outgoing, 0n);
  const label =
    hover === undefined
      ? `Last ${WEEKS} weeks`
      : `Week of ${formatDate(weeks[hover]?.start ?? 0)}`;

  return (
    <Tile
      aside={<span className="text-xs text-muted">{label}</span>}
      className="bg-linear-to-bl from-foreground/5 via-surface to-surface lg:col-span-2"
      icon={<TransferHorizontalLinearIcon {...ICON} />}
      title="Cash in and out"
    >
      <div className="flex gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Swatch tone="accent" />
            In
          </span>
          <Amount
            precision="cents"
            size="figure"
            unit={null}
            value={incoming}
          />
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Swatch tone="ink" />
            Out
          </span>
          <Amount
            precision="cents"
            size="figure"
            unit={null}
            value={outgoing}
          />
        </div>
      </div>
      {state.cash.length === 0 ? (
        <Empty>No USDC has moved in or out of your canvas yet.</Empty>
      ) : (
        <WeekBars weeks={weeks} onActive={setHover} />
      )}
    </Tile>
  );
}

function legName(
  state: CanvasState,
  kind: string | undefined,
  target: Address | undefined,
  index: number,
): string {
  switch (kind) {
    case "hold":
      return "Kept in your canvas";
    case "vault":
      return "Vault (simulated yield)";
    case "transfer":
      return target === undefined ? "Transfer" : `To ${nameOf(state, target)}`;
    default:
      return `Leg ${index + 1} (removed)`;
  }
}

function SplitCard({ state }: { readonly state: CanvasState }) {
  const href = useAppHref();
  const legs = routedByLeg(state);
  const total = legs.reduce((sum, l) => sum + l.amount, 0n);
  const route = state.account.route;
  // Before any payment, the bar shows the configured shares, so the card still says where money would go.
  const parts: Part[] =
    total > 0n
      ? legs.map((leg) => ({
          key: String(leg.index),
          label: legName(state, leg.kind, leg.target, leg.index),
          value: leg.amount,
          tone: legTone(leg.index),
        }))
      : route.map((leg, index) => ({
          key: String(index),
          label: legName(state, leg.kind, leg.target, index),
          value: BigInt(leg.bps),
          tone: legTone(index),
        }));
  const shareBps = (value: bigint, whole: bigint) =>
    whole === 0n ? 0 : Number((value * 10_000n) / whole);
  const whole = parts.reduce((sum, p) => sum + p.value, 0n);

  return (
    <Tile icon={<RoutingLinearIcon {...ICON} />} title="Routed by your Split">
      <Figure
        note={
          total > 0n
            ? `${state.routed.length} payment${state.routed.length === 1 ? "" : "s"} ran through it`
            : route.length > 0
              ? "Nothing routed yet. Shares as configured:"
              : undefined
        }
        value={
          <Amount precision="cents" size="figure" unit="USDC" value={total} />
        }
      />
      {parts.length === 0 ? (
        <Empty action="Add a Split on the canvas" href={href("/app/canvas")}>
          No Split yet: incoming money stays in your canvas.
        </Empty>
      ) : (
        <>
          <SegmentBar label="Split legs" parts={parts} />
          <ul className="flex flex-col gap-1.5">
            {parts.map((part) => (
              <li key={part.key} className="flex items-center gap-2 text-xs">
                <Swatch tone={part.tone} />
                <span className="truncate">{part.label}</span>
                <span className="ml-auto text-muted">
                  {total > 0n ? (
                    <>
                      <Amount
                        precision="cents"
                        unit={null}
                        value={part.value}
                      />{" "}
                      ·{" "}
                    </>
                  ) : null}
                  <Bps value={shareBps(part.value, whole)} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Tile>
  );
}

function WaitingCard({
  state,
  graph,
}: {
  readonly state: CanvasState;
  readonly graph: CanvasGraph;
}) {
  const href = useAppHref();
  const waiting = graph.inbox.flatMap((id) => {
    const data = graph.nodes.find((n) => n.id === id)?.data;

    if (data?.kind === "counterparty")
      return [
        {
          id,
          text: `${data.label ?? shortAddress(data.counterparty)} proposed a relationship`,
        },
      ];
    if (data?.kind === "invoice")
      return [
        {
          id,
          text: `Invoice #${data.invoice.id} from ${counterpartyOf(state, data.invoice)} to approve`,
        },
      ];

    return [];
  });

  return (
    <Tile icon={<InboxLinearIcon {...ICON} />} title="Waiting for you">
      <Figure
        note="proposals and approvals"
        value={<span className="text-2xl font-semibold">{waiting.length}</span>}
      />
      {waiting.length === 0 ? (
        <Empty>All clear. Nothing needs your signature.</Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {waiting.map((item) => (
            <li key={item.id}>
              <Link
                className="text-xs"
                href={href("/app/canvas", { focus: item.id })}
              >
                {item.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function AdvancesCard({ state }: { readonly state: CanvasState }) {
  const href = useAppHref();
  const advances = openAdvances(state);
  const principal = advances.reduce(
    (sum, inv) => sum + (inv.advance?.principal ?? 0n),
    0n,
  );

  return (
    <Tile icon={<DollarLinearIcon {...ICON} />} title="Early cash">
      <Figure
        note={
          <>
            open advances at <Bps value={state.pool.advanceRateBps} /> of face
            value
          </>
        }
        value={
          <Amount
            precision="cents"
            size="figure"
            unit="USDC"
            value={principal}
          />
        }
      />
      {advances.length === 0 ? (
        <Empty>
          No open advances. An approved invoice you sell can be advanced from
          the canvas.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {advances.map((inv) => (
            <li
              key={String(inv.id)}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <Link
                className="text-xs"
                href={href("/app/canvas", { focus: nodeId.invoice(inv.id) })}
              >
                Invoice #{String(inv.id)}
              </Link>
              <span className="text-muted">
                fee{" "}
                <Amount
                  precision="cents"
                  unit={null}
                  value={inv.advance?.fee ?? 0n}
                />{" "}
                · due {formatDate(inv.dueDate)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function PoolCard({ state }: { readonly state: CanvasState }) {
  const use = poolUse(state);

  return (
    <Tile icon={<DatabaseLinearIcon {...ICON} />} title="Funding pool">
      <Figure
        note={
          <>
            your LP position · wallet holds{" "}
            <Amount precision="cents" value={state.lp.walletUsdc} />
          </>
        }
        value={
          <Amount
            precision="cents"
            size="figure"
            unit="USDC"
            value={state.lp.assets}
          />
        }
      />
      <Meter
        color="accent"
        formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
        maxValue={1}
        size="sm"
        value={use.utilisation}
      >
        <Label className="text-xs text-muted">Pool utilisation</Label>
        <Meter.Output className="text-xs" />
        <Meter.Track>
          <Meter.Fill />
        </Meter.Track>
      </Meter>
      <span className="text-xs text-muted">
        <Amount precision="cents" unit={null} value={use.deployed} /> out on
        advances of <Amount precision="cents" value={state.pool.totalAssets} />
      </span>
    </Tile>
  );
}

function CreditCard({ state }: { readonly state: CanvasState }) {
  const lines = obligorCredit(state);

  return (
    <Tile icon={<ShieldCheckLinearIcon {...ICON} />} title="Obligor credit">
      {lines.length === 0 ? (
        <Empty>
          No enrolled buyers on your invoices. Without a credit line the pool
          advances only against escrow (ADR 0009).
        </Empty>
      ) : (
        lines.map((line) => {
          const used =
            line.limit === 0n
              ? 0
              : Number((line.outstanding * 10_000n) / line.limit) / 10_000;

          return (
            <Meter
              key={line.buyer}
              color={
                used >= 0.9 ? "danger" : used >= 0.7 ? "warning" : "accent"
              }
              formatOptions={{ style: "percent", maximumFractionDigits: 0 }}
              maxValue={1}
              size="sm"
              value={used}
            >
              <Label className="text-xs">{nameOf(state, line.buyer)}</Label>
              <Meter.Output className="text-xs" />
              <Meter.Track>
                <Meter.Fill />
              </Meter.Track>
              <span className="col-span-2 text-xs text-muted">
                <Amount
                  precision="cents"
                  unit={null}
                  value={line.outstanding}
                />{" "}
                of <Amount precision="cents" value={line.limit} /> used
              </span>
            </Meter>
          );
        })
      )}
    </Tile>
  );
}

function InvoiceTable({ state }: { readonly state: CanvasState }) {
  const href = useAppHref();
  const order = [...STATUS_ORDER, "none"] as const;
  const rows = [...state.invoices].sort(
    (a, b) =>
      order.indexOf(a.status) - order.indexOf(b.status) ||
      a.dueDate - b.dueDate,
  );

  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Invoices by status">
          <Table.Header>
            <Table.Column isRowHeader>Invoice</Table.Column>
            <Table.Column>Status</Table.Column>
            <Table.Column>Counterparty</Table.Column>
            <Table.Column>You are</Table.Column>
            <Table.Column>Face value</Table.Column>
            <Table.Column>Due</Table.Column>
            <Table.Column>Backing</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <span className="text-xs text-muted">
                No invoices yet. Issue one from a relationship on the canvas.
              </span>
            )}
          >
            {rows.map((inv) => {
              const seller = isAddressEqual(inv.seller, state.account.address);
              const financed =
                inv.status === "approved" && isFunded(inv, state.pool.address);

              return (
                <Table.Row key={String(inv.id)} id={String(inv.id)}>
                  <Table.Cell>
                    <Link
                      className="text-sm"
                      href={href("/app/canvas", {
                        focus: nodeId.invoice(inv.id),
                      })}
                    >
                      Invoice #{String(inv.id)}
                    </Link>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip
                      color={STATUS_COLOR[inv.status]}
                      size="sm"
                      variant="soft"
                    >
                      {inv.status}
                    </Chip>
                  </Table.Cell>
                  <Table.Cell>{counterpartyOf(state, inv)}</Table.Cell>
                  <Table.Cell>{seller ? "seller" : "buyer"}</Table.Cell>
                  <Table.Cell>
                    <Amount value={inv.faceValue} />
                  </Table.Cell>
                  <Table.Cell>
                    {inv.status === "paid" ? "paid" : formatDate(inv.dueDate)}
                  </Table.Cell>
                  <Table.Cell>
                    {financed
                      ? "financed"
                      : inv.escrowed > 0n
                        ? "escrow"
                        : "none"}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

function InvoicesCard({ state }: { readonly state: CanvasState }) {
  const counts = invoicesByStatus(state.invoices);
  const total = counts.reduce((sum, c) => sum + c.faceValue, 0n);

  return (
    <Tile
      className="bg-linear-to-b from-surface-secondary/60 to-surface lg:col-span-3"
      icon={<BillListLinearIcon {...ICON} />}
      title="Invoices by status"
    >
      <Figure
        note={`${state.invoices.length} invoice${state.invoices.length === 1 ? "" : "s"} across your relationships`}
        value={
          <Amount
            precision="cents"
            size="figure"
            unit="USDC face value"
            value={total}
          />
        }
      />
      {counts.length === 0 ? null : (
        <>
          <SegmentBar
            label="Face value by status"
            parts={counts.map((c) => ({
              key: c.status,
              label: `${c.status}: ${amountText(c.faceValue, { precision: "cents" })}`,
              value: c.faceValue,
              tone: STATUS_TONE[c.status],
            }))}
          />
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {counts.map((c) => (
              <li key={c.status} className="flex items-center gap-1.5 text-xs">
                <Swatch tone={STATUS_TONE[c.status]} />
                <span className="capitalize">{c.status}</span>
                <span className="text-muted">
                  {c.count} ·{" "}
                  <Amount precision="cents" unit={null} value={c.faceValue} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <InvoiceTable state={state} />
    </Tile>
  );
}

function UpcomingCard({ state }: { readonly state: CanvasState }) {
  const href = useAppHref();
  const upcoming = upcomingDue(state.invoices);

  return (
    <Tile icon={<CalendarLinearIcon {...ICON} />} title="Upcoming due dates">
      {upcoming.length === 0 ? (
        <Empty>No open invoices, so nothing falls due.</Empty>
      ) : (
        <ol className="flex flex-col">
          {upcoming.map((inv, i) => {
            const overdue = inv.dueDate <= state.now;

            return (
              <li key={String(inv.id)} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={clsx(
                      "mt-1 size-2.5 rounded-full",
                      overdue ? "bg-danger" : "bg-accent",
                    )}
                  />
                  {i === upcoming.length - 1 ? null : (
                    <span className="w-px flex-1 bg-separator" />
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-0.5 pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      className="text-xs"
                      href={href("/app/canvas", {
                        focus: nodeId.invoice(inv.id),
                      })}
                    >
                      Invoice #{String(inv.id)} · {counterpartyOf(state, inv)}
                    </Link>
                    <span className="text-xs">
                      <Amount precision="cents" value={inv.faceValue} />
                    </span>
                  </div>
                  <span
                    className={clsx(
                      "text-xs",
                      overdue ? "text-danger" : "text-muted",
                    )}
                  >
                    {formatDate(inv.dueDate)} ·{" "}
                    {formatDaysFrom(state.now, inv.dueDate)} · {inv.status}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Tile>
  );
}

function Body({
  state,
  graph,
}: {
  readonly state: CanvasState;
  readonly graph: CanvasGraph;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <BalanceCard state={state} />
      <CashCard state={state} />
      <WaitingCard graph={graph} state={state} />
      <SplitCard state={state} />
      <AdvancesCard state={state} />
      <PoolCard state={state} />
      <InvoicesCard state={state} />
      <div className="flex flex-col gap-3">
        <UpcomingCard state={state} />
        <CreditCard state={state} />
      </div>
    </div>
  );
}

export function Overview() {
  const { wallet, network, canvas, graph } = useCanvasView();

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <div className="flex items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-xs uppercase tracking-widest text-muted">
            Overview
          </span>
          <h1 className="text-2xl font-light">Your money at a glance</h1>
          <span className="text-xs text-muted">
            Read-only. Select a row to open it on the canvas.
          </span>
        </div>
        {network?.kind === "sandbox" ? (
          <Chip color="warning" size="sm" variant="soft">
            Sandbox values
          </Chip>
        ) : null}
      </div>
      {wallet === undefined || network === undefined ? (
        <Alert>
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {wallet === undefined
                ? "Connect a wallet"
                : "No network selected"}
            </Alert.Title>
            <Alert.Description>
              Connect from the sidebar and turn on Sandbox to see your canvas
              here.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : canvas.data === undefined || graph === undefined ? (
        <div className="flex items-center gap-2 text-sm">
          <Spinner size="sm" />
          {canvas.isError ? canvas.error.message : "Reading your canvas…"}
        </div>
      ) : (
        <Body graph={graph} state={canvas.data} />
      )}
    </div>
  );
}
