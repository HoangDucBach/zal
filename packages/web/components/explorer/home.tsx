"use client";

// Explorer home (docs/plans/explorer.md, "Home layout"): search, a bento of stat tiles, the charts row, then
// Latest blocks ‖ Latest txs live over SSE.

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
const HERO_ICON = { width: 18, height: 18, "aria-hidden": true } as const;
const count = new Intl.NumberFormat("en-US");

/** "2.1 s" for a running chain; minutes or hours when blocks come only on demand (a dev chain). */
function blockTime(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  if (seconds < 3_600) return `${(seconds / 60).toFixed(1)} min`;

  return `${(seconds / 3_600).toFixed(1)} h`;
}

/** Bento tiers: one accent-tinted hero, a wide secondary tile, the rest small. */
type StatTier = "hero" | "wide" | "tile";

const STAT_CARD: Record<StatTier, string> = {
  hero: "col-span-2 justify-between gap-6 bg-linear-to-br from-accent/20 via-surface to-transparent p-5 md:row-span-2",
  wide: "col-span-2 justify-between gap-3 p-4",
  tile: "justify-between gap-3 p-4",
};
const STAT_ICON: Record<StatTier, string> = {
  hero: "size-9 bg-accent/15 text-accent",
  wide: "size-7 bg-default text-muted",
  tile: "size-7 bg-default text-muted",
};
const STAT_FIGURE: Record<StatTier, string> = {
  hero: "text-5xl font-semibold tracking-tight",
  wide: "text-2xl font-semibold",
  tile: "text-xl font-semibold",
};

function Stat({
  tier = "tile",
  variant = "default",
  icon,
  label,
  children,
}: {
  readonly tier?: StatTier;
  readonly variant?: "default" | "secondary";
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Card className={STAT_CARD[tier]} variant={variant}>
      <div className="flex items-center gap-2 text-muted">
        <span
          className={`flex shrink-0 items-center justify-center rounded-full ${STAT_ICON[tier]}`}
        >
          {icon}
        </span>
        <span className={tier === "hero" ? "text-sm" : "text-xs"}>{label}</span>
      </div>
      <div className={`truncate tabular-nums ${STAT_FIGURE[tier]}`}>
        {children}
      </div>
    </Card>
  );
}

// 4 columns from md: the hero takes 2×2, small tiles fill its right, the supply tile spans 2 below.
const BENTO = "grid grid-cols-2 gap-3 md:grid-cols-4";

function Stats() {
  const stats = useExplorerStats();

  if (stats.isError) return <ReadError error={stats.error} what="Stats" />;
  const s = stats.data;

  if (s === undefined)
    return (
      <div className={BENTO}>
        <Skeleton className="col-span-2 h-44 rounded-3xl md:row-span-2 md:h-auto" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-3xl" />
        ))}
        <Skeleton className="col-span-2 h-24 rounded-3xl" />
      </div>
    );

  return (
    <div className={BENTO}>
      <Stat
        icon={<TransferHorizontalLinearIcon {...HERO_ICON} />}
        label="Transactions"
        tier="hero"
      >
        {count.format(s.totalTxs)}
      </Stat>
      <Stat icon={<LayersLinearIcon {...ICON} />} label="Latest block">
        <Link
          className="text-xl font-semibold"
          href={explorerHref.block(s.height)}
        >
          {count.format(s.height)}
        </Link>
      </Stat>
      <Stat icon={<ClockCircleLinearIcon {...ICON} />} label="Block time">
        {s.avgBlockTimeSec === null ? "–" : blockTime(s.avgBlockTimeSec)}
      </Stat>
      <Stat icon={<UsersGroupRoundedLinearIcon {...ICON} />} label="Addresses">
        {count.format(s.totalAddresses)}
      </Stat>
      <Stat icon={<RoutingLinearIcon {...ICON} />} label="Canvases">
        {count.format(s.canvases)}
      </Stat>
      <Stat
        icon={<DollarLinearIcon {...ICON} />}
        label={`${TOKEN_SYMBOL} supply`}
        tier="wide"
        variant="secondary"
      >
        <Amount
          precision="cents"
          size="figure"
          unit={TOKEN_SYMBOL}
          value={s.zusdcSupply}
        />
      </Stat>
      <Stat icon={<CodeLinearIcon {...ICON} />} label="Contracts">
        {count.format(s.totalContracts)}
      </Stat>
      <Stat icon={<GasStationLinearIcon {...ICON} />} label="Base fee">
        {s.baseFeePerGas === null ? "–" : <Gwei wei={s.baseFeePerGas} />}
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
      <ExplorerCharts />
      <Latest stream={stream} />
    </ExplorerPage>
  );
}
