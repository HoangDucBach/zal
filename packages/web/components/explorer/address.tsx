"use client";

// Explorer address page: the address with copy, a type chip, ZAX (RPC) and zUSDC balances, Open canvas for a Zal
// canvas; then Transactions, Token transfers, Tokens and NFTs.

import type { Address } from "viem";

import { Chip, Tabs, buttonVariants } from "@heroui/react";
import NextLink from "next/link";
import { getAddress, isAddress, isAddressEqual } from "viem";

import { ExplorerHeader, ExplorerPage } from "./header";
import {
  AddressLink,
  BlockLink,
  CopyButton,
  KeyValues,
  Pager,
  ReadError,
  RowsSkeleton,
  Section,
} from "./parts";
import {
  HoldingsTable,
  NATIVE,
  NftTable,
  TransferTable,
  TxTable,
} from "./tables";

import { Amount, NativeAmount } from "@/components/ui/amount";
import { liveNetwork } from "@/config/chains";
import { TOKEN_SYMBOL } from "@/config/token";
import {
  useCursorStack,
  useExplorerAddress,
  useExplorerNativeBalance,
  useExplorerPage,
} from "@/hooks/use-explorer";
import { hrefFor } from "@/hooks/use-selected-account";

const usdcAddress =
  liveNetwork.status === "ready" ? liveNetwork.addresses.usdc : undefined;

function TxsTab({ address }: { readonly address: Address }) {
  const pages = useCursorStack();
  const page = useExplorerPage("addressTxs", address, pages.before);

  if (page.isError) return <ReadError error={page.error} what="Transactions" />;
  if (page.data === undefined) return <RowsSkeleton />;

  return (
    <>
      <TxTable label="Transactions" txs={page.data.items} />
      <Pager
        next={page.data.next}
        page={pages.page}
        onNext={pages.next}
        onPrev={pages.prev}
      />
    </>
  );
}

function TransfersTab({ address }: { readonly address: Address }) {
  const pages = useCursorStack();
  const page = useExplorerPage("addressTransfers", address, pages.before);

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

function NftsTab({ address }: { readonly address: Address }) {
  const pages = useCursorStack();
  const page = useExplorerPage("addressNfts", address, pages.before);

  if (page.isError) return <ReadError error={page.error} what="NFTs" />;
  if (page.data === undefined) return <RowsSkeleton />;

  return (
    <>
      <NftTable nfts={page.data.items} />
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
  const info = useExplorerAddress(address);
  const native = useExplorerNativeBalance(address);
  const notFound =
    info.isError && info.error.kind === "api" && info.error.status === 404;
  const data = info.data;
  const zusdc = data?.holdings.find((h) =>
    usdcAddress === undefined
      ? h.token.symbol === TOKEN_SYMBOL
      : isAddressEqual(h.token.address, usdcAddress),
  );
  const type =
    data === undefined
      ? undefined
      : data.canvas !== null
        ? "Zal canvas"
        : data.isContract
          ? "contract"
          : "account";

  return (
    <ExplorerPage>
      <ExplorerHeader
        eyebrow="Address"
        title={<span className="font-mono text-xl">{address}</span>}
      >
        <CopyButton label="Copy address" value={address} />
        {notFound ? (
          <Chip size="sm" variant="soft">
            not seen on chain
          </Chip>
        ) : null}
        {type === undefined ? null : (
          <Chip
            color={data?.canvas === null ? "default" : "accent"}
            size="sm"
            variant="soft"
          >
            {type}
          </Chip>
        )}
        {data?.label === null ||
        data?.label === undefined ||
        data.label === "Zal canvas" ? null : (
          <Chip size="sm" variant="secondary">
            {data.label}
          </Chip>
        )}
        {data?.canvas === null || data?.canvas === undefined ? null : (
          <NextLink
            className={buttonVariants({ size: "sm", variant: "secondary" })}
            href={hrefFor("/app/canvas", address)}
          >
            Open canvas
          </NextLink>
        )}
      </ExplorerHeader>
      {info.isError && !notFound ? (
        <ReadError error={info.error} what="Address" />
      ) : (
        <Section title="Overview">
          <KeyValues
            rows={[
              {
                key: "native",
                label: `${NATIVE} balance`,
                value:
                  native.data === undefined ? (
                    <span className="text-muted">
                      {native.isError ? "RPC unavailable" : "–"}
                    </span>
                  ) : (
                    <NativeAmount unit={NATIVE} value={native.data.value} />
                  ),
              },
              {
                key: "zusdc",
                label: `${TOKEN_SYMBOL} balance`,
                value: (
                  <Amount
                    unit={`testnet ${TOKEN_SYMBOL}`}
                    value={zusdc?.balance ?? 0n}
                  />
                ),
              },
              {
                key: "txs",
                label: "Transactions",
                value: notFound
                  ? "0"
                  : (data?.txCount.toLocaleString("en-US") ?? "–"),
              },
              {
                key: "first",
                label: "First seen",
                value:
                  data?.firstSeenBlock === null ||
                  data?.firstSeenBlock === undefined ? (
                    <span className="text-muted">
                      {notFound ? "never" : "–"}
                    </span>
                  ) : (
                    <BlockLink number={data.firstSeenBlock} />
                  ),
              },
              ...(data?.canvas === null || data?.canvas === undefined
                ? []
                : [
                    {
                      key: "admin",
                      label: "Canvas admin",
                      value: <AddressLink address={data.canvas.admin} />,
                    },
                  ]),
              ...(data === undefined
                ? []
                : [
                    {
                      key: "nfts",
                      label: "NFTs",
                      value: data.nftCount.toLocaleString("en-US"),
                    },
                  ]),
            ]}
          />
        </Section>
      )}
      {data === undefined ? (
        notFound ? null : (
          <RowsSkeleton />
        )
      ) : (
        <Tabs variant="secondary">
          <Tabs.ListContainer>
            <Tabs.List aria-label="Address activity">
              <Tabs.Tab id="txs">
                Transactions
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="transfers">
                Token transfers
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="tokens">
                Tokens
                <Tabs.Indicator />
              </Tabs.Tab>
              <Tabs.Tab id="nfts">
                NFTs
                <Tabs.Indicator />
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
          <Tabs.Panel className="flex flex-col gap-2 pt-3" id="txs">
            <TxsTab address={address} />
          </Tabs.Panel>
          <Tabs.Panel className="flex flex-col gap-2 pt-3" id="transfers">
            <TransfersTab address={address} />
          </Tabs.Panel>
          <Tabs.Panel className="flex flex-col gap-2 pt-3" id="tokens">
            <HoldingsTable holdings={data.holdings} />
          </Tabs.Panel>
          <Tabs.Panel className="flex flex-col gap-2 pt-3" id="nfts">
            <NftsTab address={address} />
          </Tabs.Panel>
        </Tabs>
      )}
    </ExplorerPage>
  );
}

export function ExplorerAddress({ param }: { readonly param: string }) {
  const raw = decodeURIComponent(param);

  if (!isAddress(raw, { strict: false }))
    return (
      <ExplorerPage>
        <ExplorerHeader eyebrow="Address" title="Not an address" />
      </ExplorerPage>
    );

  const address = getAddress(raw.toLowerCase());

  return <Body key={address} address={address} />;
}
