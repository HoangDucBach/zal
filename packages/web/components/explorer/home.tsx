"use client";

// Explorer home (docs/plans/explorer.md, "Home layout"): search, stat tiles, Latest blocks ‖ Latest txs live over
// SSE, then the charts row.

import type { BlockSummary, TxSummary } from "@/lib/api/explorer-wire";

import {
  BoxLinearIcon,
  ClockCircleLinearIcon,
  CodeLinearIcon,
  DollarLinearIcon,
  GasStationLinearIcon,
  LayersLinearIcon,
  RoutingLinearIcon,
  TransferHorizontalLinearIcon,
  UsersGroupRoundedLinearIcon,
} from "@solar-icons/react";
import { Card, Chip, Link, Skeleton } from "@heroui/react";

import { ExplorerCharts } from "./charts";
import { ExplorerHeader, ExplorerPage } from "./header";
import {
  AddressLink,
  Ago,
  BlockLink,
  Empty,
  KindChip,
  ReadError,
  Section,
  Gwei,
  StatusChip,
  TxLink,
} from "./parts";

import { Amount } from "@/components/ui/amount";
import { TOKEN_SYMBOL } from "@/config/token";
import {
  LATEST,
  useExplorerStats,
  useExplorerStream,
  useLatestBlocks,
  useLatestTxs,
  type StreamStatus,
} from "@/hooks/use-explorer";
import { explorerHref } from "@/lib/explorer/search";

const ICON = { width: 16, height: 16, "aria-hidden": true } as const;
const count = new Intl.NumberFormat("en-US");

/** "2.1 s" for a running chain; minutes or hours when blocks come only on demand (a dev chain). */
function blockTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  if (seconds < 3_600) return `${(seconds / 60).toFixed(1)} min`;

  return `${(seconds / 3_600).toFixed(1)} h`;
}

function Stat({
  icon,
  label,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 p-3">
      <div className="flex items-center gap-2 text-muted">
        <span className="flex size-6 items-center justify-center rounded-full bg-default">
          {icon}
        </span>
        <span className="text-xs">{label}</span>
      </div>
      <div className="truncate text-lg font-semibold tabular-nums">
        {children}
      </div>
    </Card>
  );
}

function Stats() {
  const stats = useExplorerStats();

  if (stats.isError) return <ReadError error={stats.error} what="Stats" />;
  const s = stats.data;

  if (s === undefined)
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    );

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Stat icon={<LayersLinearIcon {...ICON} />} label="Height">
        <Link
          className="text-lg font-semibold"
          href={explorerHref.block(s.height)}
        >
          {count.format(s.height)}
        </Link>
      </Stat>
      <Stat icon={<ClockCircleLinearIcon {...ICON} />} label="Block time">
        {s.avgBlockTimeSec === null ? "–" : blockTime(s.avgBlockTimeSec)}
      </Stat>
      <Stat
        icon={<TransferHorizontalLinearIcon {...ICON} />}
        label="Transactions"
      >
        {count.format(s.totalTxs)}
      </Stat>
      <Stat icon={<UsersGroupRoundedLinearIcon {...ICON} />} label="Addresses">
        {count.format(s.totalAddresses)}
      </Stat>
      <Stat icon={<CodeLinearIcon {...ICON} />} label="Contracts">
        {count.format(s.totalContracts)}
      </Stat>
      <Stat icon={<RoutingLinearIcon {...ICON} />} label="Zal canvases">
        {count.format(s.canvases)}
      </Stat>
      <Stat icon={<GasStationLinearIcon {...ICON} />} label="Base fee">
        {s.baseFeePerGas === null ? "–" : <Gwei wei={s.baseFeePerGas} />}
      </Stat>
      <Stat
        icon={<DollarLinearIcon {...ICON} />}
        label={`${TOKEN_SYMBOL} supply`}
      >
        <Amount precision="cents" unit="testnet" value={s.zusdcSupply} />
      </Stat>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: LATEST }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 border-b border-separator py-2.5 last:border-b-0"
        >
          <Skeleton className="size-8 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-1/3 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <Skeleton className="h-3 w-16 rounded" />
        </div>
      ))}
    </div>
  );
}

function BlockRow({ block }: { readonly block: BlockSummary }) {
  return (
    <li className="flex items-center gap-3 border-b border-separator py-2 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-default text-muted">
        <BoxLinearIcon {...ICON} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <BlockLink number={block.number} />
        <Ago timestamp={block.timestamp} />
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm tabular-nums">
          {block.txCount} tx{block.txCount === 1 ? "" : "s"}
        </span>
        <span className="text-xs tabular-nums text-muted">
          gas {count.format(block.gasUsed)}
        </span>
      </div>
    </li>
  );
}

function TxRow({ tx }: { readonly tx: TxSummary }) {
  return (
    <li className="flex items-center gap-3 border-b border-separator py-2 last:border-b-0">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-default text-muted">
        <TransferHorizontalLinearIcon {...ICON} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <TxLink hash={tx.hash} />
        <div className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted">
          <AddressLink address={tx.from} copy={false} />
          <span aria-hidden>→</span>
          {tx.to === null ? (
            <span>create</span>
          ) : (
            <AddressLink address={tx.to} copy={false} />
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1">
          {tx.status === "reverted" ? <StatusChip status={tx.status} /> : null}
          {tx.method === null ? null : (
            <Chip size="sm" variant="secondary">
              {tx.method}
            </Chip>
          )}
          <KindChip kind={tx.kind} />
        </div>
        <Ago timestamp={tx.timestamp} />
      </div>
    </li>
  );
}

const STREAM_CHIP: Record<
  StreamStatus,
  { readonly color: "success" | "warning" | "default"; readonly text: string }
> = {
  live: { color: "success", text: "live" },
  connecting: { color: "warning", text: "connecting" },
  off: { color: "default", text: "paused" },
};

function Latest({ stream }: { readonly stream: StreamStatus }) {
  const blocks = useLatestBlocks();
  const txs = useLatestTxs();
  const chip = (
    <Chip color={STREAM_CHIP[stream].color} size="sm" variant="soft">
      {STREAM_CHIP[stream].text}
    </Chip>
  );

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Section aside={chip} title="Latest blocks">
        {blocks.isError ? (
          <ReadError error={blocks.error} what="Blocks" />
        ) : blocks.data === undefined ? (
          <ListSkeleton />
        ) : blocks.data.items.length === 0 ? (
          <Empty>No blocks indexed</Empty>
        ) : (
          <ul aria-label="Latest blocks" className="flex flex-col">
            {blocks.data.items.map((b) => (
              <BlockRow key={b.number} block={b} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Latest transactions">
        {txs.isError ? (
          <ReadError error={txs.error} what="Transactions" />
        ) : txs.data === undefined ? (
          <ListSkeleton />
        ) : txs.data.items.length === 0 ? (
          <Empty>No transactions</Empty>
        ) : (
          <ul aria-label="Latest transactions" className="flex flex-col">
            {txs.data.items.map((t) => (
              <TxRow key={t.hash} tx={t} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

export function ExplorerHome() {
  const stream = useExplorerStream();

  return (
    <ExplorerPage>
      <ExplorerHeader eyebrow="Explorer" title="Zal L1" />
      <Stats />
      <Latest stream={stream} />
      <ExplorerCharts />
    </ExplorerPage>
  );
}
