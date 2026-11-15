"use client";

// The explorer's shared parts: links between addresses, txs, blocks and tokens; copy; relative time; status
// chips; key-value lists; skeletons; empty, 404 and error states; the cursor pager.

import type { AppError } from "@/lib/query/errors";
import type { TokenRef, TxKind, TxStatus } from "@/lib/api/explorer-wire";

import { CheckReadLinearIcon, CopyLinearIcon } from "@solar-icons/react";
import {
  Alert,
  Button,
  Card,
  Chip,
  Link,
  Pagination,
  Skeleton,
  Tooltip,
} from "@heroui/react";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";

import { explorerHref } from "@/lib/explorer/search";
import { formatDateTime, formatTimeFrom } from "@/lib/format";

const ICON = { width: 14, height: 14, "aria-hidden": true } as const;

/** `0x1234…abcd`, or the first and last 6 hex digits of a hash. */
export function shortHex(value: string, head = 6, tail = 4): string {
  return value.length <= head + tail + 2
    ? value
    : `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function CopyButton({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);

    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      isIconOnly
      aria-label={copied ? "Copied" : label}
      size="sm"
      variant="ghost"
      onPress={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      {copied ? (
        <CheckReadLinearIcon {...ICON} />
      ) : (
        <CopyLinearIcon {...ICON} />
      )}
    </Button>
  );
}

/** A link with the full value in a tooltip and a copy button after it. */
function HexLink({
  href,
  value,
  text,
  copy = true,
}: {
  readonly href: string;
  readonly value: string;
  readonly text: string;
  readonly copy?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
      <Tooltip delay={300}>
        <Link className="font-mono text-sm" href={href}>
          {text}
        </Link>
        <Tooltip.Content>
          <span className="font-mono text-xs">{value}</span>
        </Tooltip.Content>
      </Tooltip>
      {copy ? <CopyButton label="Copy" value={value} /> : null}
    </span>
  );
}

export function AddressLink({
  address,
  label,
  copy = true,
  full = false,
}: {
  readonly address: string;
  /** A deployment name or `Zal canvas`, shown instead of the hex. */
  readonly label?: string | null;
  readonly copy?: boolean;
  /** Every hex digit, for a detail page's key-value list. */
  readonly full?: boolean;
}) {
  return (
    <HexLink
      copy={copy}
      href={explorerHref.address(address)}
      text={label ?? (full ? address : shortHex(address))}
      value={address}
    />
  );
}

export function TxLink({
  hash,
  copy = false,
}: {
  readonly hash: string;
  readonly copy?: boolean;
}) {
  return (
    <HexLink
      copy={copy}
      href={explorerHref.tx(hash)}
      text={shortHex(hash, 10, 6)}
      value={hash}
    />
  );
}

export function BlockLink({ number }: { readonly number: number }) {
  return (
    <Link className="text-sm tabular-nums" href={explorerHref.block(number)}>
      {number.toLocaleString("en-US")}
    </Link>
  );
}

export function TokenLink({ token }: { readonly token: TokenRef }) {
  return (
    <Link className="text-sm" href={explorerHref.token(token.address)}>
      {token.symbol ?? shortHex(token.address)}
    </Link>
  );
}

/** Seconds since the epoch, now; ticks every 10 s so relative times stay current. */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      10_000,
    );

    return () => window.clearInterval(timer);
  }, []);

  return now;
}

/** "5 min ago", with the UTC time in a tooltip. */
export function Ago({ timestamp }: { readonly timestamp: number }) {
  const now = useNow();

  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger aria-label={formatDateTime(timestamp)}>
        <span className="whitespace-nowrap text-sm text-muted">
          {formatTimeFrom(Math.max(now, timestamp), timestamp)}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <span className="text-xs">{formatDateTime(timestamp)}</span>
      </Tooltip.Content>
    </Tooltip>
  );
}

const gweiFormat = new Intl.NumberFormat("en-US", {
  maximumSignificantDigits: 4,
});

/** A gas price (wei per gas) in gwei: "0.0773 gwei". A price per unit of gas, not an amount of money. */
export function Gwei({ wei }: { readonly wei: bigint }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {gweiFormat.format(Number(formatUnits(wei, 9)))}
      <span className="text-muted"> gwei</span>
    </span>
  );
}

export function StatusChip({ status }: { readonly status: TxStatus }) {
  return (
    <Chip
      color={status === "success" ? "success" : "danger"}
      size="sm"
      variant="soft"
    >
      {status}
    </Chip>
  );
}

const KIND_COLOR: Record<TxKind, "accent" | "default" | "success" | "warning"> =
  {
    zal: "accent",
    token: "success",
    native: "default",
    deploy: "warning",
    other: "default",
  };

export function KindChip({ kind }: { readonly kind: TxKind }) {
  return (
    <Chip color={KIND_COLOR[kind]} size="sm" variant="soft">
      {kind}
    </Chip>
  );
}

/** Invoice status colours, as on the Overview: issued neutral, approved accent, paid success, else danger. */
const INVOICE_COLOR: Record<
  string,
  "default" | "accent" | "success" | "danger"
> = {
  issued: "default",
  approved: "accent",
  paid: "success",
  rejected: "danger",
  cancelled: "danger",
};

export function InvoiceStatusChip({ status }: { readonly status: string }) {
  return (
    <Chip color={INVOICE_COLOR[status] ?? "default"} size="sm" variant="soft">
      {status}
    </Chip>
  );
}

/** The decoded method, else the 4-byte selector in mono. */
export function Method({
  method,
  selector,
}: {
  readonly method: string | null;
  readonly selector: string | null;
}) {
  if (method !== null)
    return (
      <Chip size="sm" variant="secondary">
        {method}
      </Chip>
    );

  return selector === null ? (
    <span className="text-sm text-muted">transfer</span>
  ) : (
    <span className="font-mono text-xs text-muted">{selector}</span>
  );
}

export interface KeyValue {
  readonly key: string;
  readonly label: string;
  readonly value: React.ReactNode;
}

/** Label on the left, value on the right; one row per fact. */
export function KeyValues({ rows }: { readonly rows: readonly KeyValue[] }) {
  return (
    <dl className="flex flex-col">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-1 items-center gap-x-6 gap-y-1 border-b border-separator py-2 last:border-b-0 sm:grid-cols-4"
        >
          <dt className="text-xs text-muted">{row.label}</dt>
          <dd className="min-w-0 break-all text-sm sm:col-span-3">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A section card: a title row and the body. */
export function Section({
  title,
  aside,
  children,
}: {
  readonly title: string;
  readonly aside?: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 p-4">
      <Card.Header className="flex flex-row items-center gap-2">
        <Card.Title className="text-sm">{title}</Card.Title>
        {aside === undefined ? null : <div className="ml-auto">{aside}</div>}
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">{children}</Card.Content>
    </Card>
  );
}

export function RowsSkeleton({ rows = 6 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-3 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-1/4 rounded" />
          <Skeleton className="h-4 flex-1 rounded" />
          <Skeleton className="h-4 w-1/6 rounded" />
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { readonly children: React.ReactNode }) {
  return <span className="text-xs text-muted">{children}</span>;
}

/** A failed read: `Not found` for a 404, the error otherwise. */
export function ReadError({
  error,
  what,
}: {
  readonly error: AppError;
  readonly what: string;
}) {
  const notFound = error.kind === "api" && error.status === 404;

  return (
    <Alert status={notFound ? "default" : "danger"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {notFound ? `${what} not found` : "Read failed"}
        </Alert.Title>
        <Alert.Description>
          {notFound ? "Not indexed on the Zal L1" : error.message}
        </Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

/** Newer and older over a cursor list. Hidden when everything fits on one page. */
export function Pager({
  page,
  next,
  onNext,
  onPrev,
}: {
  readonly page: number;
  readonly next: string | null | undefined;
  readonly onNext: (cursor: string) => void;
  readonly onPrev: () => void;
}) {
  if (page === 1 && (next === null || next === undefined)) return null;

  return (
    <Pagination className="w-full" size="sm">
      <Pagination.Summary>Page {page}</Pagination.Summary>
      <Pagination.Content>
        <Pagination.Item>
          <Pagination.Previous isDisabled={page === 1} onPress={onPrev}>
            <Pagination.PreviousIcon />
            <span>Newer</span>
          </Pagination.Previous>
        </Pagination.Item>
        <Pagination.Item>
          <Pagination.Next
            isDisabled={next === null || next === undefined}
            onPress={() => {
              if (next !== null && next !== undefined) onNext(next);
            }}
          >
            <span>Older</span>
            <Pagination.NextIcon />
          </Pagination.Next>
        </Pagination.Item>
      </Pagination.Content>
    </Pagination>
  );
}
