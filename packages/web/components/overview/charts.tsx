"use client";

// Overview charts on Recharts, drawn to the dataviz specs: 2px lines over a soft accent wash, bars capped thin with a
// 4px rounded data end, 2px gaps, recessive axes, a HeroUI tooltip on every chart and a table twin for screen
// readers. Every colour is a theme token, so light and dark both follow the HeroUI theme.

import type { BalancePoint, WeekFlow } from "@/lib/overview/metrics";
import type { BarShapeProps } from "recharts";

import { Surface } from "@heroui/react";
import clsx from "clsx";
import { useEffect, useId, useRef } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  useActiveTooltipDataPoints,
} from "recharts";
import { formatUnits } from "viem";

import { Amount } from "@/components/ui/amount";
import { formatDate } from "@/lib/format";

/** A series colour: the SVG paint for marks and the matching Tailwind class for legend and tooltip keys. */
const TONES = {
  accent: { paint: "var(--accent)", opacity: 1, swatch: "bg-accent" },
  "accent-soft": {
    paint: "var(--accent)",
    opacity: 0.5,
    swatch: "bg-accent/50",
  },
  ink: { paint: "var(--foreground)", opacity: 0.8, swatch: "bg-foreground/80" },
  "ink-soft": {
    paint: "var(--foreground)",
    opacity: 0.4,
    swatch: "bg-foreground/40",
  },
  success: { paint: "var(--success)", opacity: 1, swatch: "bg-success" },
  danger: { paint: "var(--danger)", opacity: 1, swatch: "bg-danger" },
  "danger-soft": {
    paint: "var(--danger)",
    opacity: 0.6,
    swatch: "bg-danger/60",
  },
  neutral: { paint: "var(--default)", opacity: 1, swatch: "bg-default" },
} as const;

export type Tone = keyof typeof TONES;

export function Swatch({ tone }: { readonly tone: Tone }) {
  return (
    <span
      aria-hidden
      className={clsx("size-2 shrink-0 rounded-sm", TONES[tone].swatch)}
    />
  );
}

const usdc = (amount: bigint) => Number(formatUnits(amount, 6));

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const shortDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const dayMonth = (seconds: number) =>
  shortDate.format(new Date(seconds * 1000));

const AXIS = {
  axisLine: false,
  tickLine: false,
  tick: { fill: "var(--muted)", fontSize: 11 },
} as const;

interface TooltipRow {
  readonly key: string;
  readonly label: string;
  readonly value: React.ReactNode;
  readonly tone: Tone;
}

/** The one tooltip every chart uses: values lead, a short line in the series colour keys each row. */
function ChartTooltip({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly TooltipRow[];
}) {
  return (
    <Surface className="flex min-w-36 flex-col gap-1.5 rounded-xl border border-separator px-3 py-2 shadow-md">
      <span className="text-xs text-muted">{title}</span>
      {rows.map((row) => (
        <div key={row.key} className="flex items-center gap-2">
          <span
            aria-hidden
            className={clsx("h-0.5 w-3 rounded-full", TONES[row.tone].swatch)}
          />
          <span className="text-sm font-semibold tabular-nums">
            {row.value}
          </span>
          <span className="ml-auto pl-3 text-xs text-muted">{row.label}</span>
        </div>
      ))}
    </Surface>
  );
}

/** Reports the row under the pointer or keyboard cursor, so a card can mirror it in its headline figures. */
function ActiveRow({
  onChange,
}: {
  readonly onChange: (index: number | undefined) => void;
}) {
  const index = useActiveTooltipDataPoints<{ readonly index: number }>()?.[0]
    ?.index;

  const latest = useRef(onChange);

  latest.current = onChange;
  // Only a change of row reports; the callback itself is new on every render of the card.
  useEffect(() => latest.current(index), [index]);

  return null;
}

/**
 * A y scale with room above and below the data and two or three round ticks, so a balance that moves within a narrow
 * band fills the plot instead of hugging a zero floor.
 */
function niceScale(values: readonly number[]): {
  readonly domain: [number, number];
  readonly ticks: number[];
} {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) * 0.2 || 1;
  const low = min >= 0 ? Math.max(0, min - span * 0.25) : min - span * 0.25;
  const raw = (max + span * 0.25 - low) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const bottom = Math.floor(low / step) * step;
  const top = Math.ceil((max + span * 0.25) / step) * step;
  const ticks = Array.from(
    { length: Math.round((top - bottom) / step) + 1 },
    (_, i) => bottom + i * step,
  );

  return { domain: [bottom, top], ticks };
}

/** An x tick anchored inward at the plot's ends, so the first and last labels never hang outside the chart. */
function EdgeTick({
  x,
  y,
  payload,
  index,
  visibleTicksCount,
  format,
}: {
  readonly x?: number;
  readonly y?: number;
  readonly payload?: { readonly value: number };
  readonly index?: number;
  readonly visibleTicksCount?: number;
  readonly format: (value: number) => string;
}) {
  const anchor =
    index === 0
      ? "start"
      : index === (visibleTicksCount ?? 0) - 1
        ? "end"
        : "middle";

  return (
    <text
      dy={12}
      fill="var(--muted)"
      fontSize={11}
      textAnchor={anchor}
      x={x}
      y={y}
    >
      {format(payload?.value ?? 0)}
    </text>
  );
}

export interface BalanceChartProps {
  /** Oldest first, ending at chain time (`dailyBalance`); plotted evenly spaced, one step a day. */
  readonly points: readonly BalancePoint[];
  readonly onActive: (point: BalancePoint | undefined) => void;
}

/** Balance over time as a smooth area with an accent wash and a crosshair that snaps to each day. */
export function BalanceChart({ points, onActive }: BalanceChartProps) {
  const gradient = `balance-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const rows = points.map((p, index) => ({
    index,
    t: p.timestamp,
    balance: usdc(p.balance),
  }));
  const last = rows.length - 1;
  const y = niceScale(rows.map((r) => r.balance));

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <AreaChart
          data={rows}
          margin={{ top: 8, right: 6, bottom: 0, left: 0 }}
          title="Account balance per day. Use the arrow keys to step through the days."
        >
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--separator)" vertical={false} />
          <XAxis
            axisLine={false}
            dataKey="index"
            domain={[0, last]}
            interval={0}
            tick={
              <EdgeTick
                format={(i) => (i === last ? "now" : dayMonth(rows[i]?.t ?? 0))}
              />
            }
            tickLine={false}
            ticks={[0, last]}
            type="number"
          />
          <YAxis
            {...AXIS}
            domain={y.domain}
            tickFormatter={(v: number) => compact.format(v)}
            ticks={y.ticks}
            width={40}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as
                (typeof rows)[number] | undefined;

              return active === true && row !== undefined ? (
                <ChartTooltip
                  rows={[
                    {
                      key: "balance",
                      label: "balance",
                      value: (
                        <Amount
                          precision="cents"
                          unit={null}
                          value={points[row.index]?.balance ?? 0n}
                        />
                      ),
                      tone: "accent",
                    },
                  ]}
                  title={
                    row.index === rows.length - 1 ? "Now" : formatDate(row.t)
                  }
                />
              ) : null;
            }}
            cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
          />
          <Area
            activeDot={{
              r: 5,
              fill: "var(--accent)",
              stroke: "var(--surface)",
              strokeWidth: 2,
            }}
            dataKey="balance"
            dot={(props: { index: number; cx?: number; cy?: number }) =>
              props.index === rows.length - 1 ? (
                <circle
                  key="end"
                  cx={props.cx}
                  cy={props.cy}
                  fill="var(--accent)"
                  r={4}
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
              ) : (
                <g key={props.index} />
              )
            }
            fill={`url(#${gradient})`}
            isAnimationActive={false}
            stroke="var(--accent)"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            type="monotone"
          />
          <ActiveRow
            onChange={(i) => onActive(i === undefined ? undefined : points[i])}
          />
        </AreaChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Account balance per day</caption>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <th scope="row">{formatDate(p.timestamp)}</th>
              <td>
                <Amount precision="cents" value={p.balance} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A week's column with 4px rounded ends. A custom shape also keeps an empty week in the chart (Recharts drops
 * zero-height bars otherwise), so its faint full-height track still marks the slot.
 */
function WeekColumn(props: BarShapeProps) {
  return (props.height ?? 0) > 0 ? <Rectangle {...props} radius={4} /> : <g />;
}

export interface WeekBarsProps {
  readonly weeks: readonly WeekFlow[];
  readonly onActive: (index: number | undefined) => void;
}

/** Money in and out per week as paired columns on faint full-height tracks: in is the accent, out the neutral ink. */
export function WeekBars({ weeks, onActive }: WeekBarsProps) {
  const rows = weeks.map((w, index) => ({
    index,
    label: dayMonth(w.start),
    incoming: usdc(w.incoming),
    outgoing: usdc(w.outgoing),
  }));
  // A movement too small to see next to the largest week still draws a sliver; a week with none draws nothing.
  const sliver = (value: unknown) =>
    typeof value === "number" && value > 0 ? 3 : 0;
  const track = { fill: "var(--foreground)", fillOpacity: 0.05, radius: 4 };

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer height="100%" width="100%">
        <BarChart
          barCategoryGap="20%"
          barGap={3}
          data={rows}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          title="Money in and out per week"
        >
          <CartesianGrid stroke="var(--separator)" vertical={false} />
          <XAxis {...AXIS} dataKey="label" interval={1} />
          <YAxis
            {...AXIS}
            tickCount={3}
            tickFormatter={(v: number) => compact.format(v)}
            width={40}
          />
          <Tooltip
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as
                (typeof rows)[number] | undefined;
              const week = row === undefined ? undefined : weeks[row.index];

              return active === true && week !== undefined ? (
                <ChartTooltip
                  rows={[
                    {
                      key: "in",
                      label: "in",
                      value: (
                        <Amount
                          precision="cents"
                          unit={null}
                          value={week.incoming}
                        />
                      ),
                      tone: "accent",
                    },
                    {
                      key: "out",
                      label: "out",
                      value: (
                        <Amount
                          precision="cents"
                          unit={null}
                          value={week.outgoing}
                        />
                      ),
                      tone: "ink",
                    },
                  ]}
                  title={`Week of ${formatDate(week.start)}`}
                />
              ) : null;
            }}
            cursor={{ fill: "var(--default)", fillOpacity: 0.4, radius: 8 }}
          />
          <Bar
            background={track}
            dataKey="incoming"
            fill={TONES.accent.paint}
            isAnimationActive={false}
            maxBarSize={10}
            minPointSize={sliver}
            shape={WeekColumn}
          />
          <Bar
            background={track}
            dataKey="outgoing"
            fill={TONES.ink.paint}
            fillOpacity={TONES.ink.opacity}
            isAnimationActive={false}
            maxBarSize={10}
            minPointSize={sliver}
            shape={WeekColumn}
          />
          <ActiveRow onChange={onActive} />
        </BarChart>
      </ResponsiveContainer>
      <table className="sr-only">
        <caption>Money in and out per week, USDC</caption>
        <thead>
          <tr>
            <th scope="col">Week of</th>
            <th scope="col">In</th>
            <th scope="col">Out</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.start}>
              <th scope="row">{formatDate(w.start)}</th>
              <td>
                <Amount precision="cents" unit={null} value={w.incoming} />
              </td>
              <td>
                <Amount precision="cents" unit={null} value={w.outgoing} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface Part {
  readonly key: string;
  readonly label: string;
  readonly value: bigint;
  readonly tone: Tone;
}

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

/** One whole split into parts: a thin horizontal stack with fully rounded parts and 2px surface gaps. */
export function SegmentBar({
  parts,
  label,
}: {
  readonly parts: readonly Part[];
  readonly label: string;
}) {
  const visible = parts.filter((p) => p.value > 0n);
  const total = visible.reduce((sum, p) => sum + p.value, 0n);

  if (total === 0n)
    return (
      <div
        aria-label={label}
        className="h-2 w-full rounded-full bg-default"
        role="img"
      />
    );
  const share = (value: bigint) => Number(value) / Number(total);
  const row = Object.fromEntries(visible.map((p) => [p.key, share(p.value)]));

  return (
    <div
      aria-label={`${label}: ${visible.map((p) => `${p.label} ${percent.format(share(p.value))}`).join(", ")}`}
      className="h-4 w-full"
      role="img"
    >
      <ResponsiveContainer height="100%" width="100%">
        <BarChart
          accessibilityLayer={false}
          barCategoryGap={0}
          data={[row]}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        >
          <XAxis hide domain={[0, 1]} type="number" />
          <YAxis hide type="category" />
          <Tooltip
            allowEscapeViewBox={{ x: true, y: true }}
            content={({ active }) =>
              active === true ? (
                <ChartTooltip
                  rows={visible.map((p) => ({
                    key: p.key,
                    label: p.label,
                    value: percent.format(share(p.value)),
                    tone: p.tone,
                  }))}
                  title={label}
                />
              ) : null
            }
            cursor={false}
          />
          {visible.map((p) => (
            <Bar
              key={p.key}
              barSize={8}
              dataKey={p.key}
              fill={TONES[p.tone].paint}
              fillOpacity={TONES[p.tone].opacity}
              isAnimationActive={false}
              radius={4}
              stackId="whole"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
