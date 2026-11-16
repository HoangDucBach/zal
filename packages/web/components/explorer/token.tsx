"use client";

// Explorer token page: header key-values, then Transfers and Holders with cursor pagination.

import type { Address } from "viem";
import type { Token } from "@/lib/api/explorer-wire";

import { Chip, Tabs } from "@heroui/react";
import { getAddress, isAddress } from "viem";

import { ExplorerHeader, ExplorerPage } from "./header";
import {
  AddressLink,
  CopyButton,
  KeyValues,
  Pager,
  ReadError,
  RowsSkeleton,
  Section,
} from "./parts";
import { HolderTable, TransferTable } from "./tables";

import { TokenAmount } from "@/components/ui/amount";
import {
  PAGE_SIZE,
  useCursorStack,
  useExplorerPage,
  useExplorerToken,
} from "@/hooks/use-explorer";

const count = new Intl.NumberFormat("en-US");

function TransfersTab({ address }: { readonly address: Address }) {
  const pages = useCursorStack();
  const page = useExplorerPage("tokenTransfers", address, pages.before);

  if (page.isError) return <ReadError error={page.error} what="Transfers" />;
  if (page.data === undefined) return <RowsSkeleton />;

  return (
    <>
      <TransferTable label="Token transfers" transfers={page.data.items} />
      <Pager
        next={page.data.next}
        page={pages.page}
        onNext={pages.next}
        onPrev={pages.prev}
      />
    </>
  );
}

function HoldersTab({ token }: { readonly token: Token }) {
  const pages = useCursorStack();
  const page = useExplorerPage("tokenHolders", token.address, pages.before);

  if (page.isError) return <ReadError error={page.error} what="Holders" />;
  if (page.data === undefined) return <RowsSkeleton />;

  return (
    <>
      <HolderTable
        holders={page.data.items}
        rankFrom={(pages.page - 1) * PAGE_SIZE + 1}
        token={token}
      />
      <Pager
        next={page.data.next}
        page={pages.page}
        onNext={pages.next}
        onPrev={pages.prev}
      />
    </>
  );
}

function Body({ address }: { readonly address: Address }) {
  const token = useExplorerToken(address);
  const t = token.data?.token;

  return (
    <ExplorerPage>
      <ExplorerHeader
        eyebrow="Token"
        title={
          t === undefined ? "Token" : (t.name ?? t.symbol ?? "Unnamed token")
        }
      >
        {t === undefined ? null : (
          <>
            {t.symbol === null ? null : (
              <Chip size="sm" variant="secondary">
                {t.symbol}
              </Chip>
            )}
            <Chip size="sm" variant="soft">
              {t.standard.toUpperCase()}
            </Chip>
          </>
        )}
      </ExplorerHeader>
      {token.isError ? (
        <ReadError error={token.error} what="Token" />
      ) : t === undefined ? (
        <Section title="Overview">
          <RowsSkeleton rows={6} />
        </Section>
      ) : (
        <>
          <Section title="Overview">
            <KeyValues
              rows={[
                {
                  key: "contract",
                  label: "Contract",
                  value: (
                    <span className="flex items-center gap-1">
                      <AddressLink address={t.address} copy={false} />
                      <CopyButton label="Copy address" value={t.address} />
                    </span>
                  ),
                },
                {
                  key: "supply",
                  label: "Total supply",
                  value:
                    t.totalSupply === null ? (
                      <span className="text-muted">–</span>
                    ) : t.standard === "erc721" ? (
                      <span className="tabular-nums">
                        {count.format(t.totalSupply)}
                      </span>
                    ) : (
                      <TokenAmount
                        decimals={t.decimals}
                        unit={t.symbol}
                        value={t.totalSupply}
                      />
                    ),
                },
                {
                  key: "holders",
                  label: "Holders",
                  value: (
                    <span className="tabular-nums">
                      {count.format(t.holderCount)}
                    </span>
                  ),
                },
                {
                  key: "transfers",
                  label: "Transfers",
                  value: (
                    <span className="tabular-nums">
                      {count.format(t.transferCount)}
                    </span>
                  ),
                },
                ...(t.standard === "erc20"
                  ? [
                      {
                        key: "decimals",
                        label: "Decimals",
                        value: (
                          <span className="tabular-nums">
                            {t.decimals ?? "–"}
                          </span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          </Section>
          <Tabs variant="secondary">
            <Tabs.ListContainer>
              <Tabs.List aria-label="Token activity">
                <Tabs.Tab id="transfers">
                  Transfers
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="holders">
                  Holders
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel className="flex flex-col gap-2 pt-3" id="transfers">
              <TransfersTab address={address} />
            </Tabs.Panel>
            <Tabs.Panel className="flex flex-col gap-2 pt-3" id="holders">
              <HoldersTab token={t} />
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </ExplorerPage>
  );
}

export function ExplorerToken({ param }: { readonly param: string }) {
  const raw = decodeURIComponent(param);

  if (!isAddress(raw, { strict: false }))
    return (
      <ExplorerPage>
        <ExplorerHeader eyebrow="Token" title="Not an address" />
      </ExplorerPage>
    );
  const address = getAddress(raw.toLowerCase());

  return <Body key={address} address={address} />;
}
