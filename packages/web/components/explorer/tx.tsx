"use client";

// Explorer tx page: the key-value list (status, block, time, from → to, value, fee, gas, method), then Token
// transfers, then Logs, decoded or raw.

import type { Log } from "@/lib/api/explorer-wire";

import { Chip } from "@heroui/react";

import { ExplorerHeader, ExplorerPage } from "./header";
import {
  AddressLink,
  Ago,
  BlockLink,
  CopyButton,
  Empty,
  Gwei,
  KeyValues,
  KindChip,
  Method,
  ReadError,
  RowsSkeleton,
  Section,
  StatusChip,
} from "./parts";
import { NATIVE, TransferTable } from "./tables";

import { ExactNativeAmount } from "@/components/ui/amount";
import { useExplorerTx } from "@/hooks/use-explorer";
import { formatDateTime } from "@/lib/format";

const count = new Intl.NumberFormat("en-US");

function LogRow({ log }: { readonly log: Log }) {
  return (
    <div className="flex flex-col gap-2 border-b border-separator py-3 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs tabular-nums text-muted">#{log.logIndex}</span>
        <AddressLink address={log.address} />
        {log.decoded === null ? (
          <Chip size="sm" variant="soft">
            raw
          </Chip>
        ) : (
          <Chip color="accent" size="sm" variant="soft">
            {log.decoded.name}
          </Chip>
        )}
      </div>
      {log.decoded === null ? (
        <dl className="flex flex-col gap-1">
          {log.topics.map((t, i) => (
            <div key={i} className="flex gap-3">
              <dt className="w-14 shrink-0 text-xs text-muted">topic {i}</dt>
              <dd className="min-w-0 break-all font-mono text-xs">{t}</dd>
            </div>
          ))}
          <div className="flex gap-3">
            <dt className="w-14 shrink-0 text-xs text-muted">data</dt>
            <dd className="min-w-0 break-all font-mono text-xs">{log.data}</dd>
          </div>
        </dl>
      ) : (
        <dl className="flex flex-col gap-1">
          {Object.entries(log.decoded.args).map(([name, value]) => (
            <div key={name} className="flex gap-3">
              <dt className="w-32 shrink-0 truncate text-xs text-muted">
                {name}
              </dt>
              <dd className="min-w-0 break-all font-mono text-xs">
                {/^0x[0-9a-fA-F]{40}$/.test(value) ? (
                  <AddressLink address={value} copy={false} />
                ) : (
                  value
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function ExplorerTx({ hash }: { readonly hash: string }) {
  const tx = useExplorerTx(hash);
  const d = tx.data;

  return (
    <ExplorerPage>
      <ExplorerHeader
        eyebrow="Transaction"
        title={<span className="font-mono text-xl">{hash}</span>}
      >
        <CopyButton label="Copy hash" value={hash} />
        {d === undefined ? null : <StatusChip status={d.tx.status} />}
        {d === undefined ? null : <KindChip kind={d.tx.kind} />}
      </ExplorerHeader>
      {tx.isError ? (
        <ReadError error={tx.error} what="Transaction" />
      ) : d === undefined ? (
        <Section title="Overview">
          <RowsSkeleton rows={8} />
        </Section>
      ) : (
        <>
          <Section title="Overview">
            <KeyValues
              rows={[
                {
                  key: "status",
                  label: "Status",
                  value: <StatusChip status={d.tx.status} />,
                },
                {
                  key: "block",
                  label: "Block",
                  value: (
                    <span className="flex items-center gap-2">
                      <BlockLink number={d.tx.blockNumber} />
                      <span className="text-xs text-muted">
                        index {d.tx.index}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "time",
                  label: "Time",
                  value: (
                    <span className="flex items-center gap-2">
                      <Ago timestamp={d.tx.timestamp} />
                      <span className="text-xs text-muted">
                        {formatDateTime(d.tx.timestamp)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "from",
                  label: "From",
                  value: <AddressLink full address={d.tx.from} />,
                },
                {
                  key: "to",
                  label: d.tx.to === null ? "Created" : "To",
                  value:
                    d.tx.to !== null ? (
                      <AddressLink full address={d.tx.to} />
                    ) : d.tx.contractCreated !== null ? (
                      <AddressLink full address={d.tx.contractCreated} />
                    ) : (
                      <span className="text-muted">–</span>
                    ),
                },
                {
                  key: "value",
                  label: "Value",
                  value: <ExactNativeAmount unit={NATIVE} value={d.tx.value} />,
                },
                {
                  key: "fee",
                  label: "Fee",
                  value: (
                    <span className="flex flex-wrap items-center gap-2">
                      <ExactNativeAmount unit={NATIVE} value={d.tx.fee} />
                      <span className="text-xs text-muted">= gas × price</span>
                    </span>
                  ),
                },
                {
                  key: "gas",
                  label: "Gas used · price",
                  value: (
                    <span className="flex flex-wrap items-center gap-2 tabular-nums">
                      {count.format(d.tx.gasUsed)}
                      <span className="text-muted">·</span>
                      <Gwei wei={d.tx.effectiveGasPrice} />
                    </span>
                  ),
                },
                {
                  key: "method",
                  label: "Method",
                  value: (
                    <Method method={d.tx.method} selector={d.tx.selector} />
                  ),
                },
                {
                  key: "input",
                  label: "Input",
                  value: (
                    <span className="line-clamp-3 font-mono text-xs text-muted">
                      {d.tx.input}
                    </span>
                  ),
                },
              ]}
            />
          </Section>
          <Section title={`Token transfers · ${d.transfers.length}`}>
            {d.transfers.length === 0 ? (
              <Empty>No transfers</Empty>
            ) : (
              <TransferTable
                label="Token transfers"
                showTx={false}
                transfers={d.transfers}
              />
            )}
          </Section>
          <Section title={`Logs · ${d.logs.length}`}>
            {d.logs.length === 0 ? (
              <Empty>No logs</Empty>
            ) : (
              <div className="flex flex-col">
                {d.logs.map((log) => (
                  <LogRow key={log.logIndex} log={log} />
                ))}
              </div>
            )}
          </Section>
        </>
      )}
    </ExplorerPage>
  );
}
