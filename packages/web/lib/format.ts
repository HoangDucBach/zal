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
