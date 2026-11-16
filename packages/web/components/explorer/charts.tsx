"use client";

// The explorer's charts row: txs per day (area), active addresses (bar), zUSDC settled (area), tx kinds (donut).
// Same marks, axes, tooltip and theme-token colours as the Overview charts (components/overview/charts.tsx).

import type { ChartDay, ChartRange, TxKind } from "@/lib/api/explorer-wire";
import type { Tone } from "@/components/overview/charts";

import { Card, Skeleton, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatUnits } from "viem";

import { Empty, ReadError } from "./parts";

import {
  AXIS,
  ChartTooltip,
  Swatch,
  TONES,
  compact,
  dayMonth,
} from "@/components/overview/charts";
import { Amount } from "@/components/ui/amount";
import { TOKEN_SYMBOL } from "@/config/token";
import { useExplorerCharts } from "@/hooks/use-explorer";
import { CHART_RANGES } from "@/lib/api/explorer-wire";
import { formatDate } from "@/lib/format";

const RANGE_LABEL: Record<ChartRange, string> = {
  "1d": "1D",
  "1w": "1W",
  "1m": "1M",
  all: "ALL",
};

/** Kinds in a fixed order and colour: Zal leads in the accent, the rest step down to neutral. */
const KIND_TONE: Record<TxKind, Tone> = {
  zal: "accent",
  token: "ink",
  native: "accent-soft",
  deploy: "ink-soft",
  other: "neutral",
};

const count = new Intl.NumberFormat("en-US");

function ChartCard({
  title,
  figure,
  note,
  children,
}: {
  readonly title: string;
  readonly figure: React.ReactNode;
  readonly note: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 bg-linear-to-b from-surface-secondary/60 to-surface p-4">
      <Card.Header className="flex flex-col gap-1">
        <Card.Title className="text-xs font-normal text-muted">
          {title}
        </Card.Title>
        <div className="flex flex-wrap items-baseline gap-x-2">
          {figure}
          <span className="whitespace-nowrap text-xs text-muted">{note}</span>
        </div>
      </Card.Header>
      <Card.Content>{children}</Card.Content>
    </Card>
  );
}

const Figure = ({ value }: { readonly value: number }) => (
  <span className="text-2xl font-semibold tabular-nums">
    {count.format(value)}
  </span>
);

function DayArea({
  days,
  pick,
  tone,
  label,
  format,
}: {
  readonly days: readonly ChartDay[];
  readonly pick: (d: ChartDay) => number;
  readonly tone: Tone;
  readonly label: string;
  /** The tooltip value for one day. */
  readonly format: (d: ChartDay) => React.ReactNode;
}) {
  const gradient = `ex-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const rows = days.map((d, index) => ({ index, t: d.day, v: pick(d) }));
  const paint = TONES[tone].paint;

  return (
    <div className="h-36 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart
          data={rows}
          margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
          title={label}
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={paint} stopOpacity={0.35} />
              <stop offset="100%" stopColor={paint} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--separator)" vertical={false} />
          <XAxis
            {...AXIS}
            dataKey="t"
            minTickGap={24}
            tickFormatter={(t: number) => dayMonth(t)}
          />
          <YAxis
            {...AXIS}
            allowDecimals={false}
            tickCount={3}
            tickFormatter={(v: number) => compact.format(v)}
            width={36}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as
                (typeof rows)[number] | undefined;
              const day = row === undefined ? undefined : days[row.index];

              return active === true && day !== undefined ? (
                <ChartTooltip
                  rows={[{ key: "v", label, value: format(day), tone }]}
                  title={formatDate(day.day)}
                />
              ) : null;
            }}
            cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
          />
          <Area
            activeDot={{
              r: 4,
              fill: paint,
              stroke: "var(--surface)",
              strokeWidth: 2,
            }}
            dataKey="v"
            dot={rows.length === 1 ? { r: 3, fill: paint } : false}
            fill={`url(#${gradient})`}
            isAnimationActive={false}
            stroke={paint}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            type="monotone"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function DayBars({ days }: { readonly days: readonly ChartDay[] }) {
  const rows = days.map((d, index) => ({
    index,
    t: d.day,
    v: d.activeAddresses,
  }));

  return (
    <div className="h-36 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart
          data={rows}
          margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
          title="Active addresses per day"
        >
          <CartesianGrid stroke="var(--separator)" vertical={false} />
          <XAxis
            {...AXIS}
            dataKey="t"
            minTickGap={24}
            tickFormatter={(t: number) => dayMonth(t)}
          />
          <YAxis
            {...AXIS}
            allowDecimals={false}
            tickCount={3}
            tickFormatter={(v: number) => compact.format(v)}
            width={36}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as
                (typeof rows)[number] | undefined;

              return active === true && row !== undefined ? (
                <ChartTooltip
                  rows={[
                    {
                      key: "v",
                      label: "addresses",
                      value: count.format(row.v),
                      tone: "accent",
                    },
                  ]}
                  title={formatDate(row.t)}
                />
              ) : null;
            }}
            cursor={{ fill: "var(--default)", fillOpacity: 0.4, radius: 6 }}
          />
          <Bar
            background={{
              fill: "var(--foreground)",
              fillOpacity: 0.05,
              radius: 4,
            }}
            dataKey="v"
            fill={TONES.accent.paint}
            isAnimationActive={false}
            maxBarSize={14}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function KindsDonut({
  kinds,
}: {
  readonly kinds: readonly { readonly kind: TxKind; readonly count: number }[];
}) {
  const visible = kinds.filter((k) => k.count > 0);
  const total = visible.reduce((sum, k) => sum + k.count, 0);
  const share = (n: number) =>
    total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;

  return (
    <div className="flex h-36 items-center gap-4">
      <div className="h-full w-36 shrink-0">
        {total === 0 ? (
          <div className="flex h-full items-center justify-center">
            <Empty>No txs</Empty>
          </div>
        ) : (
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Tooltip
                content={({ active, payload }) => {
                  const k = payload?.[0]?.payload as
                    (typeof visible)[number] | undefined;

                  return active === true && k !== undefined ? (
                    <ChartTooltip
                      rows={[
                        {
                          key: k.kind,
                          label: share(k.count),
                          value: count.format(k.count),
                          tone: KIND_TONE[k.kind],
                        },
                      ]}
                      title={k.kind}
                    />
                  ) : null;
                }}
              />
              <Pie
                cornerRadius={4}
                data={visible.map((k) => ({ ...k }))}
                dataKey="count"
                innerRadius="62%"
                isAnimationActive={false}
                nameKey="kind"
                outerRadius="100%"
                paddingAngle={2}
                stroke="var(--surface)"
                strokeWidth={2}
              >
                {visible.map((k) => (
                  <Cell
                    key={k.kind}
                    fill={TONES[KIND_TONE[k.kind]].paint}
                    fillOpacity={TONES[KIND_TONE[k.kind]].opacity}
                  />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-1.5">
        {visible.map((k) => (
          <li key={k.kind} className="flex items-center gap-2 text-xs">
            <Swatch tone={KIND_TONE[k.kind]} />
            <span>{k.kind}</span>
            <span className="ml-auto tabular-nums text-muted">
              {count.format(k.count)} · {share(k.count)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const usdc = (amount: bigint) => Number(formatUnits(amount, 6));

export function ExplorerCharts() {
  const [range, setRange] = useState<ChartRange>("1m");
  const charts = useExplorerCharts(range);
  const days = charts.data?.days ?? [];
  const kinds = charts.data?.kinds ?? [];
  const txs = days.reduce((sum, d) => sum + d.txCount, 0);
  const peak = days.reduce((max, d) => Math.max(max, d.activeAddresses), 0);
  const settled = days.reduce((sum, d) => sum + d.zusdcSettled, 0n);
  const note = range === "all" ? "all time" : RANGE_LABEL[range];

  return (
    <section aria-label="Charts" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Activity</h2>
        <ToggleButtonGroup
          disallowEmptySelection
          aria-label="Range"
          selectedKeys={new Set([range])}
          selectionMode="single"
          size="sm"
          onSelectionChange={(keys) => {
            const next = [...keys][0];

            if (CHART_RANGES.includes(next as ChartRange))
              setRange(next as ChartRange);
          }}
        >
          {CHART_RANGES.map((r, i) => (
            <ToggleButton key={r} id={r}>
              {i === 0 ? null : <ToggleButtonGroup.Separator />}
              {RANGE_LABEL[r]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      {charts.isError ? (
        <ReadError error={charts.error} what="Charts" />
      ) : charts.data === undefined ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-3xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ChartCard
            figure={<Figure value={txs} />}
            note={note}
            title="Transactions"
          >
            <DayArea
              days={days}
              format={(d) => count.format(d.txCount)}
              label="txs"
              pick={(d) => d.txCount}
              tone="accent"
            />
          </ChartCard>
          <ChartCard
            figure={<Figure value={peak} />}
            note="peak / day"
            title="Active addresses"
          >
            <DayBars days={days} />
          </ChartCard>
          <ChartCard
            figure={
              <Amount
                precision="cents"
                size="figure"
                unit={TOKEN_SYMBOL}
                value={settled}
              />
            }
            note={note}
            title="Settled"
          >
            <DayArea
              days={days}
              format={(d) => (
                <Amount precision="cents" unit={null} value={d.zusdcSettled} />
              )}
              label={TOKEN_SYMBOL}
              pick={(d) => usdc(d.zusdcSettled)}
              tone="success"
            />
          </ChartCard>
          <ChartCard
            figure={
              <Figure value={kinds.reduce((sum, k) => sum + k.count, 0)} />
            }
            note={note}
            title="Tx kinds"
          >
            <KindsDonut kinds={kinds} />
          </ChartCard>
        </div>
      )}
    </section>
  );
}
