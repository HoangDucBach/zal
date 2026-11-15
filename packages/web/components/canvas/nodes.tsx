"use client";

// One xyflow node type per PRD catalogue component, plus the gate of a child canvas, its ports (ADR 0011) and drafts.
// Each is a compact HeroUI Card: an icon tile, a title and a one-line subtitle, then status chips. Solid nodes use
// the `default` variant; ghost and ended nodes the `transparent` one with a dashed outline (ADR 0003); drafts, not
// on-chain at all, the `secondary` one with an accent dashed outline. While a connection is dragged, every node
// shows whether it would accept it: valid ones ring in success, the rest dim with a not-allowed cursor.

import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import type { CanvasNodeData, Commitment } from "@/lib/canvas/graph";
import type { Draft, GateSummary, PortData } from "@/lib/canvas/layout";
import type { Connection } from "@/lib/canvas/palette";

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
import { Fragment, createContext, use, useRef, useState } from "react";

import { COMPONENT_ICONS } from "./palette";

import { HANDLE, PORT_LABELS } from "@/lib/canvas/layout";
import { CATALOGUE, DRAFT_TARGETS, describeAction } from "@/lib/canvas/palette";
import { Amount, Bps } from "@/components/ui/amount";
import { formatDaysFrom, shortAddress } from "@/lib/format";

type Data<K extends CanvasNodeData["kind"]> = Extract<
  CanvasNodeData,
  { kind: K }
>;
type Props<K extends CanvasNodeData["kind"]> = NodeProps<Node<Data<K>>>;

/** What a gate's Open button does: the canvas provides it, so a node card stays a plain view. */
export const GateActions = createContext<{
  readonly open: (id: GateSummary["id"]) => void;
}>({ open: () => undefined });

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

function CommitmentChip({
  commitment,
  ended,
}: {
  readonly commitment: Commitment;
  readonly ended?: string;
}) {
  if (commitment === "solid") return null;

  return (
    <Chip
      color={commitment === "ended" ? "danger" : "warning"}
      size="sm"
      variant="soft"
    >
      {commitment === "ended" ? (ended ?? "ended") : "ghost"}
    </Chip>
  );
}

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

function Frame({
  id,
  commitment,
  selected,
  icon,
  title,
  subtitle,
  chips,
}: {
  readonly id: string;
  readonly commitment: Commitment;
  readonly selected: boolean;
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly subtitle: React.ReactNode;
  readonly chips?: React.ReactNode;
}) {
  const solid = commitment === "solid";

  return (
    <ConnectState id={id}>
      {(connect) => (
        <Card
          className={`group w-56 gap-2 p-2.5 ${solid ? "border border-border" : "border border-dashed border-muted/60"} ${selected ? "ring-2 ring-accent" : ""} ${connect}`}
          variant={solid ? "default" : "transparent"}
        >
          <DirectionalHandles />
          <div className="flex items-center gap-2.5">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${TILE[commitment]}`}
            >
              {icon}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{title}</span>
              <span className="truncate text-xs text-muted">{subtitle}</span>
            </div>
          </div>
          {chips === undefined ? null : (
            <div className="flex flex-wrap gap-1">{chips}</div>
          )}
        </Card>
      )}
    </ConnectState>
  );
}

function AccountNode({ id, data, selected }: Props<"account">) {
  const { account, commitment } = data;

  return (
    <Frame
      chips={
        <>
          <CommitmentChip commitment={commitment} />
          <Chip size="sm" variant="tertiary">
            testnet zUSDC
          </Chip>
        </>
      }
      commitment={commitment}
      icon={<WalletIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={
        account.exists ? (
          <>
            <Amount value={account.balance} /> · {shortAddress(account.address)}
          </>
        ) : (
          "Not created yet"
        )
      }
      title="Account"
    />
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

  return (
    <Frame
      chips={
        <>
          <Chip size="sm" variant="secondary">
            {theirRole}
          </Chip>
          <CommitmentChip commitment={commitment} ended={relationship.status} />
          {awaitingMe ? (
            <Chip color="accent" size="sm" variant="soft">
              needs your answer
            </Chip>
          ) : relationship.status === "proposed" ? (
            <Chip size="sm" variant="soft">
              waiting for acceptance
            </Chip>
          ) : null}
        </>
      }
      commitment={commitment}
      icon={<UserRoundedIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={`${shortAddress(counterparty)} · relationship #${relationship.id}`}
      title={label ?? "Counterparty"}
    />
  );
}

function InvoiceNode({ id, data, selected }: Props<"invoice">) {
  const { invoice, commitment, funded, escrowBacked, awaitingMe, now } = data;

  return (
    <Frame
      chips={
        <>
          <Chip
            color={
              invoice.status === "paid"
                ? "success"
                : invoice.status === "approved"
                  ? "accent"
                  : "default"
            }
            size="sm"
            variant="soft"
          >
            {invoice.status}
          </Chip>
          <CommitmentChip commitment={commitment} ended={invoice.status} />
          {escrowBacked ? (
            <Chip color="success" size="sm" variant="soft">
              escrow-backed
            </Chip>
          ) : null}
          {funded ? (
            <Chip color="warning" size="sm" variant="soft">
              financed
            </Chip>
          ) : null}
          {awaitingMe ? (
            <Chip color="accent" size="sm" variant="soft">
              needs approval
            </Chip>
          ) : null}
        </>
      }
      commitment={commitment}
      icon={<BillListIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={
        <>
          <Amount value={invoice.faceValue} /> ·{" "}
          {invoice.status === "paid"
            ? "settled"
            : `due ${formatDaysFrom(now, invoice.dueDate)}`}
        </>
      }
      title={`Invoice #${invoice.id}`}
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
      selected={selected}
      subtitle={
        <>
          <Amount unit={null} value={budget.used} /> of{" "}
          <Amount value={budget.limit} /> ·{" "}
          {Math.round(budget.periodLength / 86_400)} days
        </>
      }
      title={`Budget #${budget.id}`}
    />
  );
}

function ApprovalNode({ id, data, selected }: Props<"approval">) {
  const { account } = data;
  const pending = account.ops.filter((op) => !op.executed && !op.stale).length;
  const approvers = account.members.filter(
    (m) => m.role === "admin" || m.role === "approver",
  ).length;

  return (
    <Frame
      chips={
        pending > 0 ? (
          <Chip color="accent" size="sm" variant="soft">
            {pending} waiting
          </Chip>
        ) : undefined
      }
      commitment="solid"
      icon={<ShieldCheckIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={
        <>
          {account.threshold} of {approvers} sign above{" "}
          <Amount value={account.approvalLimit} />
        </>
      }
      title="Approval"
    />
  );
}

function SplitNode({ id, data, selected }: Props<"split">) {
  const { account, commitment } = data;
  const legs = account.route.map((leg, i) => (
    <Fragment key={i}>
      {i > 0 ? " · " : null}
      {leg.kind === "transfer"
        ? shortAddress(leg.target)
        : leg.kind === "vault"
          ? "Vault"
          : "Hold"}{" "}
      <Bps value={leg.bps} />
    </Fragment>
  ));

  return (
    <Frame
      chips={
        <>
          <CommitmentChip commitment={commitment} />
          <Chip size="sm" variant="secondary">
            endpoint {account.endpointPublic ? "public" : "private"}
          </Chip>
        </>
      }
      commitment={commitment}
      icon={<RoutingIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={legs.length === 0 ? "No route · money is held" : legs}
      title="Split"
    />
  );
}

function EscrowNode({ id, data, selected }: Props<"escrow">) {
  return (
    <Frame
      commitment="solid"
      icon={<LockIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={
        <>
          <Amount value={data.invoice.escrowed} /> locked for #
          {String(data.invoice.id)}
        </>
      }
      title="Escrow"
    />
  );
}

function ScheduleNode({ id, data, selected }: Props<"schedule">) {
  const { invoice, commitment, now } = data;

  return (
    <Frame
      chips={
        <>
          <CommitmentChip commitment={commitment} />
          <Chip size="sm" variant="secondary">
            keeper (sandbox)
          </Chip>
        </>
      }
      commitment={commitment}
      icon={<ClockCircleIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={`Invoice #${invoice.id} · ${
        invoice.status === "paid"
          ? "settled"
          : `settles ${formatDaysFrom(now, invoice.dueDate)}`
      }`}
      title="Schedule"
    />
  );
}

function VaultNode({ id, data, selected }: Props<"vault">) {
  return (
    <Frame
      chips={
        <Chip color="warning" size="sm" variant="soft">
          simulated yield
        </Chip>
      }
      commitment="solid"
      icon={<SafeSquareIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={<Amount value={data.account.vaultAssets} />}
      title="Vault"
    />
  );
}

function PoolNode({ id, data, selected }: Props<"pool">) {
  const { pool, financed } = data;

  return (
    <Frame
      chips={
        financed.length > 0 || data.lpAssets > 0n ? (
          <>
            {financed.length > 0 ? (
              <Chip color="warning" size="sm" variant="soft">
                {financed.length} financed
              </Chip>
            ) : null}
            {data.lpAssets > 0n ? (
              <Chip size="sm" variant="secondary">
                your LP{" "}
                <Amount precision="cents" unit={null} value={data.lpAssets} />
              </Chip>
            ) : null}
          </>
        ) : undefined
      }
      commitment="solid"
      icon={<DatabaseIcon {...ICON} />}
      id={id}
      selected={selected}
      subtitle={
        <>
          <Bps value={pool.advanceRateBps} /> advance ·{" "}
          <Amount precision="cents" unit={null} value={pool.idleCash} /> idle
        </>
      }
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
      className={`w-72 gap-2.5 border border-accent/40 bg-linear-to-br from-accent/15 via-surface to-surface p-3 ${selected ? "ring-2 ring-accent" : ""}`}
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
            <span className="truncate text-sm font-semibold">{gate.name}</span>
            <span className="text-xs text-muted">
              {gate.nodeCount} node{gate.nodeCount === 1 ? "" : "s"} · child
              canvas
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

/** What a gate port means, in one line: its tooltip (ADR 0011). */
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
    <ConnectState
      id={id}
      idleHint={`Off-chain · connects to ${DRAFT_TARGETS[component]}`}
    >
      {(connect) => (
        <Card
          className={`group w-56 gap-2 border border-dashed border-accent/60 p-2.5 ${selected ? "ring-2 ring-accent" : ""} ${connect}`}
          variant="secondary"
        >
          <DirectionalHandles />
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              {COMPONENT_ICONS[component]}
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{title}</span>
              <span className="truncate text-xs text-muted">
                Not on-chain yet
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Chip color="accent" size="sm" variant="soft">
              Draft
            </Chip>
          </div>
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
