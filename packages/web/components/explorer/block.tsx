"use client";

// Explorer block page: header key-values, then its transactions.

import type { TxSummary } from "@/lib/api/explorer-wire";

import { Link } from "@heroui/react";

import { ExplorerHeader, ExplorerPage } from "./header";
import {
  AddressLink,
  Ago,
  CopyButton,
  Gwei,
  KeyValues,
  Pager,
  ReadError,
  RowsSkeleton,
  Section,
} from "./parts";
import { TxTable } from "./tables";

import {
  useBlockTxsPage,
  useCursorStack,
  useExplorerBlock,
} from "@/hooks/use-explorer";
import { explorerHref } from "@/lib/explorer/search";
import { formatDateTime } from "@/lib/format";

const count = new Intl.NumberFormat("en-US");
const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** The block's first txs page comes with the block; later pages from `GET /txs?block=`. */
function BlockTxs({
  number,
  first,
  firstNext,
}: {
  readonly number: number;
  readonly first: readonly TxSummary[];
  readonly firstNext: string | null;
}) {
  const pages = useCursorStack();
  const later = useBlockTxsPage(number, pages.before);
  const txs = pages.before === undefined ? first : later.data?.items;
  const next = pages.before === undefined ? firstNext : later.data?.next;

  if (later.isError)
    return <ReadError error={later.error} what="Transactions" />;
  if (txs === undefined) return <RowsSkeleton />;

  return (
    <>
      <TxTable label="Block transactions" txs={txs} />
      <Pager
        next={next}
        page={pages.page}
        onNext={pages.next}
        onPrev={pages.prev}
      />
    </>
  );
}

export function ExplorerBlock({ id }: { readonly id: string }) {
  const block = useExplorerBlock(decodeURIComponent(id));
  const d = block.data;
  const b = d?.block;

  return (
    <ExplorerPage>
      <ExplorerHeader
        eyebrow="Block"
        title={
          <span className="tabular-nums">
            {b === undefined
              ? /^\d+$/.test(id)
                ? `#${count.format(Number(id))}`
                : "Block"
              : `#${count.format(b.number)}`}
          </span>
        }
      >
        {b === undefined ? null : (
          <div className="flex items-center gap-1">
            {b.number === 0 ? null : (
              <Link className="text-xs" href={explorerHref.block(b.number - 1)}>
                ← {count.format(b.number - 1)}
              </Link>
            )}
            <span className="text-muted">·</span>
            <Link className="text-xs" href={explorerHref.block(b.number + 1)}>
              {count.format(b.number + 1)} →
            </Link>
          </div>
        )}
      </ExplorerHeader>
      {block.isError ? (
        <ReadError error={block.error} what="Block" />
      ) : d === undefined || b === undefined ? (
        <Section title="Overview">
          <RowsSkeleton rows={8} />
        </Section>
      ) : (
        <>
          <Section title="Overview">
            <KeyValues
              rows={[
                {
                  key: "time",
                  label: "Time",
                  value: (
                    <span className="flex items-center gap-2">
                      <Ago timestamp={b.timestamp} />
                      <span className="text-xs text-muted">
                        {formatDateTime(b.timestamp)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "txs",
                  label: "Transactions",
                  value: <span className="tabular-nums">{b.txCount}</span>,
                },
                {
                  key: "hash",
                  label: "Hash",
                  value: (
                    <span className="flex items-center gap-1 font-mono text-xs">
                      {b.hash}
                      <CopyButton label="Copy hash" value={b.hash} />
                    </span>
                  ),
                },
                {
                  key: "parent",
                  label: "Parent",
                  value: (
                    <Link
                      className="font-mono text-xs"
                      href={explorerHref.block(
                        b.number === 0 ? 0 : b.number - 1,
                      )}
                    >
                      {b.parentHash}
                    </Link>
                  ),
                },
                {
                  key: "gas",
                  label: "Gas used / limit",
                  value: (
                    <span className="tabular-nums">
                      {count.format(b.gasUsed)} / {count.format(b.gasLimit)}{" "}
                      <span className="text-xs text-muted">
                        {b.gasLimit === 0n
                          ? ""
                          : percent.format(
                              Number(b.gasUsed) / Number(b.gasLimit),
                            )}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "base",
                  label: "Base fee",
                  value:
                    b.baseFeePerGas === null ? (
                      <span className="text-muted">–</span>
                    ) : (
                      <Gwei wei={b.baseFeePerGas} />
                    ),
                },
                {
                  key: "miner",
                  label: "Fee recipient",
                  value: <AddressLink full address={b.miner} />,
                },
              ]}
            />
          </Section>
          <Section title={`Transactions · ${b.txCount}`}>
            <BlockTxs first={d.txs} firstNext={d.txsNext} number={b.number} />
          </Section>
        </>
      )}
    </ExplorerPage>
  );
}
