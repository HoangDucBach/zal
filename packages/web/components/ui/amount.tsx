// The one place money becomes text (AGENTS.md, "Money is the loudest text"): the figure in the foreground colour,
// semibold and tabular, the unit after it muted and regular. test/no-inline-amounts.test.ts keeps the formatters
// here, so a hand-formatted amount anywhere else fails the suite.

import { formatBps, formatUsdc, formatUsdcCents } from "@/lib/format";

/** `exact` keeps every base unit ("5,000.000001"); `cents` rounds for display figures ("14,854.99"). */
export type Precision = "exact" | "cents";

/** `inline` takes the surrounding text size; `figure` and `hero` are the Overview card headlines. */
export type AmountSize = "inline" | "figure" | "hero";

const FIGURE_SIZE: Record<AmountSize, string> = {
  inline: "",
  figure: "text-2xl",
  hero: "text-5xl",
};
const UNIT_SIZE: Record<AmountSize, string> = {
  inline: "",
  figure: "text-sm",
  hero: "text-sm",
};

export interface AmountProps {
  /** USDC base units, 6 decimals. */
  readonly value: bigint;
  /** Shown muted after the figure. `null` when a column header or card already names it. */
  readonly unit?: string | null;
  readonly precision?: Precision;
  /** Prefix the figure with its direction: `+` in, `−` out (the value's own sign is dropped). */
  readonly signed?: boolean;
  readonly size?: AmountSize;
}

const MINUS = "−";

function figure(value: bigint, precision: Precision, signed: boolean): string {
  const magnitude = value < 0n ? -value : value;
  const text =
    precision === "cents" ? formatUsdcCents(magnitude) : formatUsdc(magnitude);

  if (signed) return `${value < 0n ? MINUS : "+"}${text}`;

  return value < 0n ? `${MINUS}${text}` : text;
}

function Money({
  text,
  unit,
  size,
}: {
  readonly text: string;
  readonly unit: string | null;
  readonly size: AmountSize;
}) {
  return (
    <span className="whitespace-nowrap">
      <span
        className={`font-semibold text-foreground tabular-nums ${FIGURE_SIZE[size]}`}
      >
        {text}
      </span>
      {unit === null ? null : (
        <span className={`font-normal text-muted ${UNIT_SIZE[size]}`}>
          {" "}
          {unit}
        </span>
      )}
    </span>
  );
}

export function Amount({
  value,
  unit = "USDC",
  precision = "exact",
  signed = false,
  size = "inline",
}: AmountProps) {
  return (
    <Money size={size} text={figure(value, precision, signed)} unit={unit} />
  );
}

/** "3,950.00 USDC" inside a sentence; the capture group keeps each match as its own part when splitting. */
const USDC_IN_TEXT = /(\d{1,3}(?:,\d{3})*(?:\.\d+)? USDC)/;

/**
 * Text that arrives already formatted, such as a notification detail from the API (lib/api/wire.ts), with each
 * USDC figure in it rendered the way `Amount` renders one.
 */
export function AmountsInText({ text }: { readonly text: string }) {
  return text
    .split(USDC_IN_TEXT)
    .map((part, i) =>
      i % 2 === 1 ? (
        <Money
          key={i}
          size="inline"
          text={part.slice(0, -" USDC".length)}
          unit="USDC"
        />
      ) : (
        part
      ),
    );
}

/** A rate or share that decides money (advance rate, split legs, fee rate), as "80%" with the amount's weight. */
export function Bps({ value }: { readonly value: number }) {
  return (
    <span className="font-semibold whitespace-nowrap text-foreground tabular-nums">
      {formatBps(value)}
    </span>
  );
}

/**
 * The same figure as plain text, for the few places that take only a string: aria labels, chart tooltip rows,
 * native `<title>`s. Visible text uses `Amount`.
 */
export function amountText(
  value: bigint,
  {
    unit = "USDC",
    precision = "exact",
    signed = false,
  }: Pick<AmountProps, "unit" | "precision" | "signed"> = {},
): string {
  const text = figure(value, precision, signed);

  return unit === null ? text : `${text} ${unit}`;
}

export function bpsText(value: number): string {
  return formatBps(value);
}
