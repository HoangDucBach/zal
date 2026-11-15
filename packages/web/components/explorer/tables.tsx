"use client";

// The explorer's tables: transactions, token transfers, holdings, NFTs and holders. Every hex links to its page.

import type {
  Holder,
  Nft,
  TokenRef,
  Transfer,
  TxSummary,
} from "@/lib/api/explorer-wire";

import { Table } from "@heroui/react";

import {
  AddressLink,
  Ago,
  BlockLink,
  Empty,
  InvoiceStatusChip,
  KindChip,
  Method,
  StatusChip,
  TokenLink,
  TxLink,
} from "./parts";

import { Amount, ExactNativeAmount, TokenAmount } from "@/components/ui/amount";
import { env } from "@/config/env";
import { formatDate } from "@/lib/format";

export const NATIVE = env.l1NativeSymbol;

export function TxTable({
  txs,
  label,
  empty = "No transactions",
}: {
  readonly txs: readonly TxSummary[];
  readonly label: string;
  readonly empty?: string;
}) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            <Table.Column isRowHeader>Tx</Table.Column>
            <Table.Column>Method</Table.Column>
            <Table.Column>Block</Table.Column>
            <Table.Column>Age</Table.Column>
            <Table.Column>From</Table.Column>
            <Table.Column>To</Table.Column>
            <Table.Column>Value</Table.Column>
            <Table.Column>Fee</Table.Column>
            <Table.Column>Status</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <Empty>{empty}</Empty>}>
            {txs.map((tx) => (
              <Table.Row key={tx.hash} id={tx.hash}>
                <Table.Cell>
                  <TxLink hash={tx.hash} />
                </Table.Cell>
                <Table.Cell>
                  <div className="flex items-center gap-1">
                    <Method method={tx.method} selector={tx.selector} />
                    <KindChip kind={tx.kind} />
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <BlockLink number={tx.blockNumber} />
                </Table.Cell>
                <Table.Cell>
                  <Ago timestamp={tx.timestamp} />
                </Table.Cell>
                <Table.Cell>
                  <AddressLink address={tx.from} copy={false} />
                </Table.Cell>
                <Table.Cell>
                  {tx.to === null ? (
                    <span className="text-xs text-muted">create</span>
                  ) : (
                    <AddressLink address={tx.to} copy={false} />
                  )}
                </Table.Cell>
                <Table.Cell>
                  <ExactNativeAmount
                    maxFraction={6}
                    unit={NATIVE}
                    value={tx.value}
                  />
                </Table.Cell>
                <Table.Cell>
                  <ExactNativeAmount
                    maxFraction={8}
                    unit={NATIVE}
                    value={tx.fee}
                  />
                </Table.Cell>
                <Table.Cell>
                  <StatusChip status={tx.status} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/** An ERC-20 amount in its token's units, or an ERC-721 id. */
export function TransferAmount({
  token,
  value,
  tokenId,
}: {
  readonly token: TokenRef;
  readonly value: bigint | null;
  readonly tokenId: bigint | null;
}) {
  if (tokenId !== null)
    return <span className="font-mono text-sm">#{tokenId.toString()}</span>;
  if (value === null) return <span className="text-muted">–</span>;

  return (
    <TokenAmount decimals={token.decimals} unit={token.symbol} value={value} />
  );
}

export function TransferTable({
  transfers,
  label,
  showTx = true,
}: {
  readonly transfers: readonly Transfer[];
  readonly label: string;
  readonly showTx?: boolean;
}) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label={label}>
          <Table.Header>
            <Table.Column isRowHeader>{showTx ? "Tx" : "Log"}</Table.Column>
            <Table.Column>Age</Table.Column>
            <Table.Column>Token</Table.Column>
            <Table.Column>From</Table.Column>
            <Table.Column>To</Table.Column>
            <Table.Column>Amount</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <Empty>No transfers</Empty>}>
            {transfers.map((t) => (
              <Table.Row
                key={`${t.txHash}:${t.logIndex}`}
                id={`${t.txHash}:${t.logIndex}`}
              >
                <Table.Cell>
                  {showTx ? (
                    <TxLink hash={t.txHash} />
                  ) : (
                    <span className="text-sm tabular-nums">{t.logIndex}</span>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Ago timestamp={t.timestamp} />
                </Table.Cell>
                <Table.Cell>
                  <TokenLink token={t.token} />
                </Table.Cell>
                <Table.Cell>
                  <AddressLink address={t.from} copy={false} />
                </Table.Cell>
                <Table.Cell>
                  <AddressLink address={t.to} copy={false} />
                </Table.Cell>
                <Table.Cell>
                  <TransferAmount
                    token={t.token}
                    tokenId={t.tokenId}
                    value={t.value}
                  />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export function HoldingsTable({
  holdings,
}: {
  readonly holdings: readonly {
    readonly token: TokenRef;
    readonly balance: bigint;
  }[];
}) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Token holdings">
          <Table.Header>
            <Table.Column isRowHeader>Token</Table.Column>
            <Table.Column>Standard</Table.Column>
            <Table.Column>Balance</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <Empty>No tokens</Empty>}>
            {holdings.map((h) => (
              <Table.Row key={h.token.address} id={h.token.address}>
                <Table.Cell>
                  <TokenLink token={h.token} />
                </Table.Cell>
                <Table.Cell>
                  <span className="text-xs uppercase text-muted">
                    {h.token.standard}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  {h.token.standard === "erc721" ? (
                    <span className="tabular-nums">{h.balance.toString()}</span>
                  ) : (
                    <TokenAmount
                      decimals={h.token.decimals}
                      unit={h.token.symbol}
                      value={h.balance}
                    />
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export function NftTable({ nfts }: { readonly nfts: readonly Nft[] }) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="NFTs">
          <Table.Header>
            <Table.Column isRowHeader>Token</Table.Column>
            <Table.Column>Id</Table.Column>
            <Table.Column>Invoice</Table.Column>
            <Table.Column>Face value</Table.Column>
            <Table.Column>Due</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <Empty>No NFTs</Empty>}>
            {nfts.map((n) => (
              <Table.Row
                key={`${n.token.address}:${n.tokenId}`}
                id={`${n.token.address}:${n.tokenId}`}
              >
                <Table.Cell>
                  <TokenLink token={n.token} />
                </Table.Cell>
                <Table.Cell>
                  <span className="font-mono text-sm">
                    #{n.tokenId.toString()}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  {n.invoice === null ? (
                    <span className="text-muted">–</span>
                  ) : (
                    <InvoiceStatusChip status={n.invoice.status} />
                  )}
                </Table.Cell>
                <Table.Cell>
                  {n.invoice === null ? (
                    <span className="text-muted">–</span>
                  ) : (
                    <Amount value={n.invoice.faceValue} />
                  )}
                </Table.Cell>
                <Table.Cell>
                  {n.invoice === null ? (
                    <span className="text-muted">–</span>
                  ) : (
                    <span className="text-sm">
                      {formatDate(n.invoice.dueDate)}
                    </span>
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export function HolderTable({
  holders,
  token,
  rankFrom,
}: {
  readonly holders: readonly Holder[];
  readonly token: TokenRef;
  /** The rank of the first row on this page. */
  readonly rankFrom: number;
}) {
  return (
    <Table variant="secondary">
      <Table.ScrollContainer>
        <Table.Content aria-label="Holders">
          <Table.Header>
            <Table.Column isRowHeader>Rank</Table.Column>
            <Table.Column>Holder</Table.Column>
            <Table.Column>Balance</Table.Column>
          </Table.Header>
          <Table.Body renderEmptyState={() => <Empty>No holders</Empty>}>
            {holders.map((h, i) => (
              <Table.Row key={h.holder} id={h.holder}>
                <Table.Cell>
                  <span className="text-sm tabular-nums text-muted">
                    {rankFrom + i}
                  </span>
                </Table.Cell>
                <Table.Cell>
                  <AddressLink address={h.holder} />
                </Table.Cell>
                <Table.Cell>
                  {token.standard === "erc721" ? (
                    <span className="tabular-nums">{h.balance.toString()}</span>
                  ) : (
                    <TokenAmount
                      decimals={token.decimals}
                      unit={token.symbol}
                      value={h.balance}
                    />
                  )}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}
