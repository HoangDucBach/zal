import { formatUnits, type Address } from "viem";

const usdcFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

/** USDC base units (6 decimals) as "5,000.00". Never rounds away a base unit. */
export function formatUsdc(amount: bigint): string {
  return usdcFormat.format(Number(formatUnits(amount, 6)));
}

const centsFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** USDC base units rounded to cents, "14,854.99", for display figures. Tables and forms keep `formatUsdc`. */
export function formatUsdcCents(amount: bigint): string {
  return centsFormat.format(Number(formatUnits(amount, 6)));
}

/** Whole or decimal USDC typed by a person, to base units. `undefined` for anything that is not an amount. */
export function parseUsdc(text: string): bigint | undefined {
  const trimmed = text.replace(/,/g, "").trim();
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(trimmed);

  if (match === null) return undefined;
  const whole = match[1] ?? "0";
  const fraction = (match[2] ?? "").padEnd(6, "0");

  return BigInt(whole) * 1_000_000n + BigInt(fraction);
}

const nativeFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** The L1's native gas token in wei (18 decimals) as "0.05". Display only: it rounds to 4 decimals. */
export function formatNative(wei: bigint): string {
  return nativeFormat.format(Number(formatUnits(wei, 18)));
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

export function shortAddress(address: Address): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

/** Chain time (seconds) as a UTC date, the way the contracts compare it. */
export function formatDate(timestamp: number): string {
  return dateFormat.format(new Date(timestamp * 1000));
}

export function formatDateTime(timestamp: number): string {
  return `${dateTimeFormat.format(new Date(timestamp * 1000))} UTC`;
}

/** Whole days from `now` to `then`, rounded up, as "in 30 days", "today" or "3 days ago". */
export function formatDaysFrom(now: number, then: number): string {
  const days = Math.ceil((then - now) / 86_400);

  if (days === 0) return "today";

  return days > 0
    ? `in ${days} day${days === 1 ? "" : "s"}`
    : `${-days} day${days === -1 ? "" : "s"} ago`;
}

/** Time from `now` to `then` in the largest whole unit: "in 3 min", "in 2 h", "in 4 d", "now", "5 min ago". */
export function formatTimeFrom(now: number, then: number): string {
  const diff = then - now;
  const size = Math.abs(diff);

  if (size < 60) return diff > 0 ? "in < 1 min" : "now";
  const [count, unit] =
    size < 3_600
      ? [Math.floor(size / 60), "min"]
      : size < 86_400
        ? [Math.floor(size / 3_600), "h"]
        : [Math.floor(size / 86_400), "d"];

  return diff > 0 ? `in ${count} ${unit}` : `${count} ${unit} ago`;
}

/**
 * A token amount in base units with `decimals`, every digit kept, the integer part grouped: "1,250.000001".
 * Trailing zeros are dropped. Used for tokens of any decimals and for exact native fees. `maxFraction` cuts the
 * fraction to that many digits (rounding down) for a table column; the detail page shows every digit.
 */
export function formatToken(
  amount: bigint,
  decimals: number,
  maxFraction?: number,
): string {
  const negative = amount < 0n;
  const [whole = "0", fraction = ""] = formatUnits(
    negative ? -amount : amount,
    decimals,
  ).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cut = (
    maxFraction === undefined ? fraction : fraction.slice(0, maxFraction)
  ).replace(/0+$/, "");
  const text = cut === "" ? grouped : `${grouped}.${cut}`;

  return negative ? `-${text}` : text;
}
