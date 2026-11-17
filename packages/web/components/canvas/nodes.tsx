"use client";

// One xyflow node type per PRD catalogue component, plus the gate of a child canvas, its ports and drafts.
// Each is a HeroUI Card with a structured head (icon tile, muted kind label, title, one status chip) and one row per
// fact. Solid nodes use the `default` variant; ghost and ended nodes the `transparent` one with a dashed
// outline; drafts, not on-chain at all, the `secondary` one with an accent dashed outline. While a
// connection is dragged, every node shows whether it would accept it: valid ones ring in success, the rest dim with
// a not-allowed cursor.

import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import type { CanvasNodeData, Commitment } from "@/lib/canvas/graph";
import type { Draft, GateSummary, PortData } from "@/lib/canvas/layout";
import type { Connection } from "@/lib/canvas/palette";
import type { ZalNetwork } from "@/config/chains";

import { Button, Card, Chip, Tooltip } from "@heroui/react";
import {
  ArrowRightIcon,
  BillListIcon,
  CaseMinimalisticIcon,
  ClockCircleIcon,
  DatabaseIcon,
  LayersMinimalisticIcon,
  LinkIcon,
  LockIcon,
  RoutingIcon,
  SafeSquareIcon,
  ShieldCheckIcon,
  UserRoundedIcon,
  WalletIcon,
} from "@solar-icons/react/linear";
import { Handle, Position, useConnection } from "@xyflow/react";
import { createContext, use, useRef, useState } from "react";

import { AccountDetails } from "./account-node";
import { useAccountWindow } from "./approval-parts";
import { NodeAddress, NodeRow, NodeRows, policySummary } from "./node-parts";
import { COMPONENT_ICONS } from "./palette";
import {
  RunScheduleButton,
  ScheduleStatusChip,
  recipientText,
  useScheduleClock,
} from "./schedule-parts";

import { AuroraGlow } from "@/components/ui/aurora-glow";
import { HANDLE, PORT_LABELS } from "@/lib/canvas/layout";
import { CATALOGUE, DRAFT_TARGETS, describeAction } from "@/lib/canvas/palette";
import { Amount, Bps } from "@/components/ui/amount";
import { shortHex } from "@/components/ui/copy-button";
import { cadenceText, committed } from "@/lib/canvas/schedules";
import { formatDateTime, formatDaysFrom, formatTimeFrom } from "@/lib/format";

type Data<K extends CanvasNodeData["kind"]> = Extract<
  CanvasNodeData,
  { kind: K }
>;
type Props<K extends CanvasNodeData["kind"]> = NodeProps<Node<Data<K>>>;

/** The network the canvas acts on, for the few cards that send a transaction themselves (Run now). */
export const CanvasNetwork = createContext<ZalNetwork | undefined>(undefined);

/** What a gate's Open button does: the canvas provides it, so a node card stays a plain view. */
export const GateActions = createContext<{
  readonly open: (id: GateSummary["id"]) => void;
}>({ open: () => undefined });

/** What the ghost Account's Create button does: the canvas opens the same form as the palette's Account. */
export const AccountActions = createContext<{ readonly create: () => void }>({
  create: () => undefined,
});

/**
 * How the canvas judges a connection from one node to another (`canConnect`), so a node card can show while a
 * connection is dragged whether it would accept it. `undefined`: that pair cannot connect at all (a gate, a port).
 */
export const ConnectRules = createContext<{
  readonly judge: (from: string, to: string) => Connection | undefined;
}>({ judge: () => undefined });

type ConnectTarget =
  | { readonly state: "idle" }
  | { readonly state: "source" }
  | { readonly state: "valid" | "invalid"; readonly hint: string };

/** This node's part in the connection being dragged, if one is. */
function useConnectTarget(id: string): ConnectTarget {
  const from = useConnection((c) => (c.inProgress ? c.fromNode.id : undefined));
  const { judge } = use(ConnectRules);

  if (from === undefined) return { state: "idle" };
  if (from === id) return { state: "source" };
  const result = judge(from, id);

  return result === undefined
    ? {
        state: "invalid",
        hint: "Connections end on a node, not a gate or port",
      }
    : result.ok
      ? { state: "valid", hint: describeAction(result.action) }
      : { state: "invalid", hint: result.reason };
}

const CONNECT_CLASS: Record<ConnectTarget["state"], string> = {
  idle: "",
  source: "ring-2 ring-accent",
  valid: "ring-2 ring-success",
  invalid: "cursor-not-allowed opacity-40",
};

/**
 * The connect state as a card wrapper: the ring or dimming, and while the dragged connection is over this node a
 * tooltip saying what dropping it here would do, or why it cannot. `idleHint`, when given, is the tooltip on a
 * plain hover.
 */
function ConnectState({
  id,
  idleHint,
  children,
}: {
  readonly id: string;
  readonly idleHint?: string;
  readonly children: (className: string) => React.ReactNode;
}) {
  const target = useConnectTarget(id);
  const [over, setOver] = useState(false);
  const [lingered, setLingered] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const connecting = target.state === "valid" || target.state === "invalid";
  const text = connecting
    ? target.state === "valid"
      ? `Connect: ${target.hint}`
      : target.hint
    : target.state === "idle"
      ? idleHint
      : undefined;
  const open = text !== undefined && over && (connecting || lingered);

  return (
    <Tooltip closeDelay={0} delay={0} isOpen={open} trigger="focus">
      <Tooltip.Trigger
        data-connect={target.state}
        onPointerEnter={() => {
          setOver(true);
          timer.current = window.setTimeout(() => setLingered(true), TIP_DELAY);
        }}
        onPointerLeave={() => {
          window.clearTimeout(timer.current);
          setOver(false);
          setLingered(false);
        }}
      >
        {children(CONNECT_CLASS[target.state])}
      </Tooltip.Trigger>
      <Tooltip.Content showArrow className="max-w-64" placement="top">
        <Tooltip.Arrow />
        <span
          className="text-xs break-normal"
          data-testid={connecting ? "connect-hint" : "node-hint"}
        >
          {text}
        </span>
      </Tooltip.Content>
    </Tooltip>
  );
}

const ICON = { size: 16, "aria-hidden": true } as const;
/** Hover tooltips on the canvas open quickly: they explain, they do not interrupt. */
const TIP_DELAY = 400;

const TILE: Record<Commitment | "gate", string> = {
  solid: "bg-accent/15 text-accent",
  ghost: "bg-default text-muted",
  ended: "bg-danger/15 text-danger",
  gate: "bg-accent text-accent-foreground",
};

/** Shown while the pointer is on the card, so the edge you drag a connection from is there when you need it. */
const HOVER_HANDLE = "opacity-0 group-hover:opacity-100";

function DirectionalHandles() {
  return (
    <>
      <Handle
        className={HOVER_HANDLE}
        id="left-in"
        position={Position.Left}
        type="target"
      />
      <Handle
        className={HOVER_HANDLE}
        id="left-out"
        position={Position.Left}
        type="source"
      />
      <Handle
        className={HOVER_HANDLE}
        id="top-in"
        position={Position.Top}
        type="target"
      />
      <Handle
        className={HOVER_HANDLE}
        id="top-out"
        position={Position.Top}
        type="source"
      />
      <Handle
        className={HOVER_HANDLE}
        id="right-in"
        position={Position.Right}
        type="target"
      />
      <Handle
        className={HOVER_HANDLE}
        id="right-out"
        position={Position.Right}
        type="source"
      />
      <Handle
        className={HOVER_HANDLE}
        id="bottom-in"
        position={Position.Bottom}
        type="target"
      />
      <Handle
        className={HOVER_HANDLE}
        id="bottom-out"
        position={Position.Bottom}
        type="source"
      />
    </>
  );
}

/** Each gate port type enters or leaves on its own side: inflow left, outflow right, links top and bottom. */
function PortHandles() {
  return (
    <>
      <Handle id={HANDLE.inflow} position={Position.Left} type="target" />
      <Handle id={HANDLE.outflow} position={Position.Right} type="source" />
      <Handle id={HANDLE.linkIn} position={Position.Top} type="target" />
      <Handle id={HANDLE.linkOut} position={Position.Bottom} type="source" />
    </>
  );
}

/** The card's head: icon tile, the muted kind label over the title, and at most one status chip. */
function Header({
  tile,
  icon,
  kind,
  title,
  status,
}: {
  readonly tile: string;
  readonly icon: React.ReactNode;
  readonly kind: string;
  readonly title: React.ReactNode;
  readonly status?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${tile}`}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-muted">{kind}</span>
        <span className="text-sm font-semibold break-words">{title}</span>
      </div>
      {status}
    </div>
  );
}

/**
 * A node card: header, then one row per fact. Solid nodes use the `default` variant; ghost and ended
 * nodes the `transparent` one with a dashed outline.
 */
function Frame({
  id,
  commitment,
  selected,
  icon,
  kind,
  title,
  status,
  rows,
  footer,
}: {
  readonly id: string;
  readonly commitment: Commitment;
  readonly selected: boolean;
  readonly icon: React.ReactNode;
  readonly kind: string;
  readonly title: React.ReactNode;
  readonly status?: React.ReactNode;
  readonly rows?: React.ReactNode;
  readonly footer?: React.ReactNode;
}) {
  const solid = commitment === "solid";

  return (
    <ConnectState id={id}>
      {(connect) => (
        <Card
          className={`group w-64 gap-2.5 p-3 ${solid ? "border border-border" : "border border-dashed border-muted/60"} transition-colors hover:border-accent hover:ring-1 hover:ring-accent/60 ${selected ? "ring-2 ring-accent" : ""} ${connect}`}
          variant={solid ? "default" : "transparent"}
        >
          <DirectionalHandles />
          <Header
            icon={icon}
            kind={kind}
            status={status}
            tile={TILE[commitment]}
            title={title}
          />
          {rows === undefined ? null : <NodeRows>{rows}</NodeRows>}
          {footer}
        </Card>
      )}
    </ConnectState>
  );
}

/**
 * The root of every flow and the largest card: balance first, then the details that used to sit in the Inspector.
 * A light runs once around its border about every 3 s.
 */
function AccountNode({ id, data, selected }: Props<"account">) {
  const { account, commitment, labels } = data;
  const { create } = use(AccountActions);
  const network = use(CanvasNetwork);
  const solid = commitment === "solid";

  return (
    <ConnectState id={id}>
      {(connect) => (
        <Card
          className={`group w-80 gap-0 p-0 ${solid ? "dark isolate bg-background text-foreground shadow-md" : "border border-dashed border-muted/60 transition-colors hover:border-accent hover:ring-1 hover:ring-accent/60"} ${selected ? "ring-2 ring-accent" : ""} ${connect}`}
          variant={solid ? "default" : "transparent"}
        >
          {solid ? (
            // The Card does not clip, so the connection handles on its edges stay whole; the light is clipped here.
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-3xl">
              <AuroraGlow orientation="tall" />
            </div>
          ) : null}
          <DirectionalHandles />
          <div className="flex items-center gap-3 p-4 pb-6">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${solid ? "bg-surface/60 text-accent backdrop-blur-sm" : TILE.ghost}`}
            >
              <WalletIcon {...ICON} />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-xs font-medium text-foreground/80">
                Account
              </span>
              {solid ? (
                <Amount
                  precision="cents"
                  size="figure"
                  value={account.balance}
                />
              ) : (
                <span className="text-sm font-semibold">Not created</span>
              )}
            </div>
          </div>
          <div
            className={
              solid
                ? "m-2 mt-0 rounded-xl bg-surface/45 p-3 backdrop-blur-2xl"
                : "p-4 pt-0"
            }
          >
            {solid ? (
              <AccountDetails
                account={account}
                labels={labels}
                network={network}
              />
            ) : (
              <Button className="nodrag" size="sm" onPress={create}>
                Create canvas
              </Button>
            )}
          </div>
        </Card>
      )}
    </ConnectState>
  );
}

function CounterpartyNode({ id, data, selected }: Props<"counterparty">) {
  const {
    relationship,
    counterparty,
    theirRole,
    label,
    awaitingMe,
    commitment,
  } = data;
  const status = awaitingMe
    ? "needs your answer"
    : relationship.status === "proposed"
      ? "waiting for acceptance"
      : relationship.status === "active"
        ? undefined
        : relationship.status;

  return (
    <Frame
      commitment={commitment}
      icon={<UserRoundedIcon {...ICON} />}
      id={id}
      kind="Counterparty"
      rows={
        <>
          <NodeRow
            label="Address"
            value={
              <NodeAddress
                label="Copy counterparty address"
                value={counterparty}
              />
            }
          />
          <NodeRow label="Relationship" value={`#${relationship.id}`} />
          {status === undefined ? null : (
            <NodeRow
              label="Status"
              value={
                <span className={awaitingMe ? "text-accent" : undefined}>
                  {status}
                </span>
              }
            />
          )}
        </>
      }
      selected={selected}
      status={
        <Chip size="sm" variant="secondary">
          {theirRole}
        </Chip>
      }
      title={label ?? shortHex(counterparty)}
    />
  );
}

const INVOICE_CHIP: Record<string, "success" | "accent" | "danger"> = {
  paid: "success",
  approved: "accent",
  rejected: "danger",
  cancelled: "danger",
};

function InvoiceNode({ id, data, selected }: Props<"invoice">) {
  const { invoice, commitment, funded, escrowBacked, awaitingMe, now } = data;

  return (
    <Frame
      commitment={commitment}
      icon={<BillListIcon {...ICON} />}
      id={id}
      kind="Invoice"
      rows={
        <>
          <NodeRow label="Face" value={<Amount value={invoice.faceValue} />} />
          {invoice.status === "paid" ? null : (
            <NodeRow label="Due" value={formatDaysFrom(now, invoice.dueDate)} />
          )}
          {escrowBacked ? <NodeRow label="Backed by" value="Escrow" /> : null}
          {funded ? <NodeRow label="Financed by" value="Pool" /> : null}
          {awaitingMe ? (
            <NodeRow
              label="Next"
              value={<span className="text-accent">your approval</span>}
            />
          ) : null}
        </>
      }
      selected={selected}
      status={
        <Chip
          color={INVOICE_CHIP[invoice.status] ?? "default"}
          size="sm"
          variant="soft"
        >
          {invoice.status}
        </Chip>
      }
      title={`#${invoice.id}`}
    />
  );
}

function BudgetNode({ id, data, selected }: Props<"budget">) {
  const { budget } = data;

  return (
    <Frame
      commitment="solid"
      icon={<CaseMinimalisticIcon {...ICON} />}
      id={id}
      kind="Budget"
      rows={
        <>
          <NodeRow label="Limit" value={<Amount value={budget.limit} />} />
          <NodeRow label="Used" value={<Amount value={budget.used} />} />
          <NodeRow
            label="Period"
            value={`${Math.round(budget.periodLength / 86_400)} days`}
          />
        </>
      }
      selected={selected}
      title={`#${budget.id}`}
    />
  );
}

function ApprovalNode({ id, data, selected }: Props<"approval">) {
  const { account } = data;
  const window = useAccountWindow(use(CanvasNetwork), account);
  const pending = account.ops.filter((op) => !op.executed && !op.stale).length;

  return (
    <Frame
      commitment="solid"
      icon={<ShieldCheckIcon {...ICON} />}
      id={id}
      kind="Approval"
      rows={
        account.threshold < 2 ? undefined : (
          <>
            <NodeRow
              label="One signature up to"
              value={<Amount value={account.approvalLimit} />}
            />
            <NodeRow label="Window" value="24 h" />
            {window.data === undefined ? null : (
              <NodeRow
                label="Used"
                value={<Amount value={window.data.spent} />}
              />
            )}
          </>
        )
      }
      selected={selected}
      status={
        pending > 0 ? (
          <Chip color="accent" size="sm" variant="soft">
            {pending} waiting
          </Chip>
        ) : undefined
      }
      title={policySummary(account)}
    />
  );
}

function SplitNode({ id, data, selected }: Props<"split">) {
  const { account, commitment } = data;
  const legs = account.route;

  return (
    <Frame
      commitment={commitment}
      icon={<RoutingIcon {...ICON} />}
      id={id}
      kind="Split"
      rows={
        legs.length === 0 ? (
          <NodeRow label="Route" value="Hold all" />
        ) : (
          legs.map((leg, i) => (
            <NodeRow
              key={i}
              label={
                leg.kind === "transfer" ? (
                  <NodeAddress label="Copy payee address" value={leg.target} />
                ) : leg.kind === "vault" ? (
                  "Vault"
                ) : (
                  "Hold"
                )
              }
              value={<Bps value={leg.bps} />}
            />
          ))
        )
      }
      selected={selected}
      title={
        legs.length === 0
          ? "No route"
          : `${legs.length} leg${legs.length === 1 ? "" : "s"}`
      }
    />
  );
}

function EscrowNode({ id, data, selected }: Props<"escrow">) {
  return (
    <Frame
      commitment="solid"
      icon={<LockIcon {...ICON} />}
      id={id}
      kind="Escrow"
      rows={
        <NodeRow
          label="Locked"
          value={<Amount value={data.invoice.escrowed} />}
        />
      }
      selected={selected}
      title={`Invoice #${data.invoice.id}`}
    />
  );
}

function ScheduleNode({ id, data, selected }: Props<"schedule">) {
  const { schedule: view, commitment, label } = data;
  const { now, keeper } = useScheduleClock();
  const network = use(CanvasNetwork);
  const live = view.status === "active" || view.status === "pending";

  return (
    <Frame
      // A schedule that ran all its runs is done, not refused: faded, without the danger tile of a cancel.
      commitment={view.status === "ended" ? "ghost" : commitment}
      footer={
        network === undefined ? null : (
          <RunScheduleButton network={network} view={view} />
        )
      }
      icon={<ClockCircleIcon {...ICON} />}
      id={id}
      kind="Schedule"
      rows={
        <>
          <NodeRow label="Amount" value={<Amount value={view.amount} />} />
          <NodeRow label="To" value={recipientText(view, label)} />
          <NodeRow label="Every" value={cadenceText(view.interval)} />
          {live ? (
            <>
              <NodeRow label="Runs left" value={view.remaining} />
              <NodeRow
                label="Committed"
                value={<Amount precision="cents" value={committed(view)} />}
              />
              <NodeRow
                label="Next"
                value={
                  <span className="flex flex-col items-end">
                    <span>{formatTimeFrom(now, view.nextAt)}</span>
                    <span className="font-normal text-muted">
                      {formatDateTime(view.nextAt)}
                    </span>
                  </span>
                }
              />
            </>
          ) : null}
          {view.status === "active" && keeper === "offline" ? (
            <NodeRow
              label="Keeper"
              value={
                <span className="text-warning">offline, run manually</span>
              }
            />
          ) : null}
        </>
      }
      selected={selected}
      status={<ScheduleStatusChip view={view} />}
      title={view.id === undefined ? "New" : `#${view.id}`}
    />
  );
}

function VaultNode({ id, data, selected }: Props<"vault">) {
  return (
    <Frame
      commitment="solid"
      icon={<SafeSquareIcon {...ICON} />}
      id={id}
      kind="Vault"
      rows={
        <NodeRow
          label="Assets"
          value={<Amount value={data.account.vaultAssets} />}
        />
      }
      selected={selected}
      title="Vault"
    />
  );
}

function PoolNode({ id, data, selected }: Props<"pool">) {
  const { pool, financed } = data;

  return (
    <Frame
      commitment="solid"
      icon={<DatabaseIcon {...ICON} />}
      id={id}
      kind="Pool"
      rows={
        <>
          <NodeRow
            label="Advance rate"
            value={<Bps value={pool.advanceRateBps} />}
          />
          <NodeRow
            label="Idle"
            value={<Amount precision="cents" value={pool.idleCash} />}
          />
          {financed.length > 0 ? (
            <NodeRow label="Financed" value={financed.length} />
          ) : null}
          {data.lpAssets > 0n ? (
            <NodeRow
              label="Your LP"
              value={<Amount precision="cents" value={data.lpAssets} />}
            />
          ) : null}
        </>
      }
      selected={selected}
      title="Funding pool"
    />
  );
}

function GateNode({
  data,
  selected,
}: NodeProps<Node<{ kind: "gate"; gate: GateSummary }>>) {
  const { gate } = data;
  const { open } = use(GateActions);

  return (
    <Card
      className={`w-72 gap-2.5 border border-accent/40 transition-colors hover:border-accent hover:ring-1 hover:ring-accent/60 bg-linear-to-br from-accent/15 via-surface to-surface p-3 ${selected ? "ring-2 ring-accent" : ""}`}
      variant="default"
    >
      <PortHandles />
      <div className="flex items-center gap-2.5">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${TILE.gate}`}
        >
          <LayersMinimalisticIcon {...ICON} />
        </span>
        <Tooltip delay={TIP_DELAY}>
          <Tooltip.Trigger className="flex min-w-0 flex-1 flex-col">
            <span className="text-xs text-muted">Child canvas</span>
            <span className="text-sm font-semibold break-words">
              {gate.name}
            </span>
            <span className="text-xs text-muted">
              {gate.nodeCount} node{gate.nodeCount === 1 ? "" : "s"}
            </span>
          </Tooltip.Trigger>
          <Tooltip.Content showArrow className="max-w-64" placement="top">
            <Tooltip.Arrow />
            <span className="text-xs break-normal">
              Ports: money in · money out · links across the edge
            </span>
          </Tooltip.Content>
        </Tooltip>
        <Button
          className="nodrag"
          size="sm"
          variant="secondary"
          onPress={() => open(gate.id)}
        >
          Open
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col rounded-lg bg-surface-secondary/70 px-2 py-1.5">
          <span className="text-muted">Money in</span>
          <Amount precision="cents" value={gate.moneyIn} />
        </div>
        <div className="flex flex-col rounded-lg bg-surface-secondary/70 px-2 py-1.5">
          <span className="text-muted">Money out</span>
          <Amount precision="cents" value={gate.moneyOut} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {gate.waiting > 0 ? (
          <Chip color="accent" size="sm" variant="soft">
            {gate.waiting} waiting for you
          </Chip>
        ) : null}
        {(["inflow", "outflow", "link"] as const).map((port) =>
          gate.ports[port] > 0 ? (
            <Chip key={port} size="sm" variant="tertiary">
              {PORT_LABELS[port]} {gate.ports[port]}
            </Chip>
          ) : null,
        )}
      </div>
    </Card>
  );
}

const PORT_ICON = {
  inflow: <ArrowRightIcon {...ICON} />,
  outflow: <ArrowRightIcon {...ICON} />,
  link: <LinkIcon {...ICON} />,
} as const;

/** What a gate port means, in one line: its tooltip. */
function portHint(data: PortData): string {
  switch (data.port) {
    case "link":
      return `Link with ${data.label} · no money moves`;
    case "outflow":
      return `Money out to ${data.label}`;
    case "inflow":
      return `Money in from ${data.label}`;
  }
}

function PortNode({ data, selected }: NodeProps<Node<PortData>>) {
  return (
    <Tooltip delay={TIP_DELAY}>
      <Tooltip.Trigger>
        <Card
          className={`w-48 flex-row items-center gap-2 rounded-full border border-dashed border-accent/50 bg-surface/80 px-2 py-1.5 ${selected ? "ring-2 ring-accent" : ""}`}
          variant="default"
        >
          <PortHandles />
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            {PORT_ICON[data.port]}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="text-xs text-muted">
              {PORT_LABELS[data.port]}{" "}
              {data.port === "inflow"
                ? "from"
                : data.port === "outflow"
                  ? "to"
                  : "with"}
            </span>
            <span className="truncate text-xs font-medium">{data.label}</span>
          </div>
        </Card>
      </Tooltip.Trigger>
      <Tooltip.Content showArrow className="max-w-64" placement="top">
        <Tooltip.Arrow />
        <span className="text-xs break-normal" data-testid="port-hint">
          {portHint(data)}
        </span>
      </Tooltip.Content>
    </Tooltip>
  );
}

function DraftNode({
  id,
  data,
  selected,
}: NodeProps<Node<{ kind: "draft"; draft: Draft }>>) {
  const { component } = data.draft;
  const title =
    CATALOGUE.find((c) => c.component === component)?.title ?? "Draft";

  return (
    <ConnectState id={id} idleHint={`Connects to ${DRAFT_TARGETS[component]}`}>
      {(connect) => (
        <Card
          className={`group w-64 gap-2.5 border border-dashed border-accent/60 transition-colors hover:border-accent hover:ring-1 hover:ring-accent/60 p-3 ${selected ? "ring-2 ring-accent" : ""} ${connect}`}
          variant="secondary"
        >
          <DirectionalHandles />
          <Header
            icon={COMPONENT_ICONS[component]}
            kind="New"
            status={
              <Chip color="accent" size="sm" variant="soft">
                Draft
              </Chip>
            }
            tile="bg-accent/10 text-accent"
            title={title}
          />
        </Card>
      )}
    </ConnectState>
  );
}

const components = {
  account: AccountNode,
  counterparty: CounterpartyNode,
  invoice: InvoiceNode,
  budget: BudgetNode,
  approval: ApprovalNode,
  split: SplitNode,
  escrow: EscrowNode,
  schedule: ScheduleNode,
  vault: VaultNode,
  pool: PoolNode,
  gate: GateNode,
  port: PortNode,
  draft: DraftNode,
} satisfies Record<CanvasNodeData["kind"] | "gate" | "port" | "draft", unknown>;

/** xyflow types nodes loosely; each component above narrows its own `data` by kind. */
export const nodeTypes = components as unknown as NodeTypes;

export const NODE_ICONS: Record<
  CanvasNodeData["kind"] | "gate",
  React.ReactNode
> = {
  account: <WalletIcon {...ICON} />,
  counterparty: <UserRoundedIcon {...ICON} />,
  invoice: <BillListIcon {...ICON} />,
  budget: <CaseMinimalisticIcon {...ICON} />,
  approval: <ShieldCheckIcon {...ICON} />,
  split: <RoutingIcon {...ICON} />,
  escrow: <LockIcon {...ICON} />,
  schedule: <ClockCircleIcon {...ICON} />,
  vault: <SafeSquareIcon {...ICON} />,
  pool: <DatabaseIcon {...ICON} />,
  gate: <LayersMinimalisticIcon {...ICON} />,
};
