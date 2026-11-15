import { describe, expect, it } from "vitest";

import { parseBlockEvent } from "./explorer";
import {
  addressResponseSchema,
  blockResponseSchema,
  chartsResponseSchema,
  pageSchema,
  searchResponseSchema,
  statsResponseSchema,
  tokenResponseSchema,
  transferSchema,
  txResponseSchema,
  txSummarySchema,
  nftSchema,
} from "./explorer-wire";

const asOf = { block: 120, updatedAt: 1_763_000_000 };
const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const ZUSDC = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const HASH = `0x${"ab".repeat(32)}`;
const PARENT = `0x${"cd".repeat(32)}`;

const tokenRef = {
  address: ZUSDC,
  symbol: "zUSDC",
  decimals: 6,
  standard: "erc20",
};
const txSummary = {
  hash: HASH,
  blockNumber: "120",
  timestamp: 1_763_000_000,
  from: A,
  to: B,
  value: "0",
  fee: "21000000000000",
  status: "success",
  method: "payInvoice",
  selector: "0x12345678",
  kind: "zal",
};
const transfer = {
  txHash: HASH,
  logIndex: 0,
  blockNumber: "120",
  timestamp: 1_763_000_000,
  token: tokenRef,
  from: A,
  to: B,
  value: "5000000000",
  tokenId: null,
};

describe("explorer wire", () => {
  it("parses /stats", () => {
    const stats = statsResponseSchema.parse({
      asOf,
      height: "120",
      totalTxs: 340,
      totalAddresses: 25,
      totalContracts: 9,
      avgBlockTimeSec: 2.1,
      baseFeePerGas: "25000000000",
      zusdcSupply: "1000000000000",
      canvases: 4,
    });

    expect(stats.height).toBe(120);
    expect(stats.baseFeePerGas).toBe(25_000_000_000n);
    expect(stats.zusdcSupply).toBe(1_000_000_000_000n);
  });

  it("parses a block with its first txs", () => {
    const detail = blockResponseSchema.parse({
      asOf,
      block: {
        number: "120",
        hash: HASH,
        parentHash: PARENT,
        timestamp: 1_763_000_000,
        txCount: 1,
        gasUsed: "21000",
        gasLimit: "15000000",
        baseFeePerGas: null,
        miner: A,
      },
      txs: [txSummary],
      txsNext: "MTIwOjA",
    });

    expect(detail.block.number).toBe(120);
    expect(detail.block.baseFeePerGas).toBeNull();
    expect(detail.block.miner).toBe(
      "0x1111111111111111111111111111111111111111",
    );
    expect(detail.txs[0]?.kind).toBe("zal");
    expect(detail.txsNext).toBe("MTIwOjA");
  });

  it("parses a tx summary: checksummed addresses, null `to` on create, unknown kind as other", () => {
    const tx = txSummarySchema.parse({
      ...txSummary,
      to: null,
      method: null,
      kind: "bridge",
      status: "reverted",
      from: ZUSDC,
    });

    expect(tx.to).toBeNull();
    expect(tx.kind).toBe("other");
    expect(tx.status).toBe("reverted");
    expect(tx.from).toBe("0x5FbDB2315678afecb367f032d93F642f64180aa3");
  });

  it("parses a tx with logs and transfers", () => {
    const detail = txResponseSchema.parse({
      asOf,
      tx: {
        ...txSummary,
        index: 0,
        gasUsed: "120000",
        effectiveGasPrice: "25000000000",
        contractCreated: null,
        input: "0x12345678",
      },
      logs: [
        {
          logIndex: 0,
          address: ZUSDC,
          topics: [HASH],
          data: "0x",
          decoded: {
            name: "Transfer",
            args: { from: A, to: B, value: "5000000000", ids: [1, 2] },
          },
        },
        {
          logIndex: 1,
          address: B,
          topics: [],
          data: "0xdead",
          decoded: null,
        },
      ],
      transfers: [transfer],
    });

    expect(detail.tx.effectiveGasPrice).toBe(25_000_000_000n);
    expect(detail.logs[0]?.decoded?.args.ids).toBe("[1,2]");
    expect(detail.logs[1]?.decoded).toBeNull();
    expect(detail.transfers[0]?.value).toBe(5_000_000_000n);
  });

  it("parses an ERC-721 transfer and an Invoice NFT", () => {
    const nftRef = {
      ...tokenRef,
      symbol: null,
      decimals: null,
      standard: "erc721",
    };
    const t = transferSchema.parse({
      ...transfer,
      token: nftRef,
      value: null,
      tokenId: "7",
    });

    expect(t.value).toBeNull();
    expect(t.tokenId).toBe(7n);
    const nft = nftSchema.parse({
      token: nftRef,
      tokenId: "7",
      invoice: {
        status: "approved",
        faceValue: "5000000000",
        dueDate: 1_765_000_000,
      },
    });

    expect(nft.invoice?.faceValue).toBe(5_000_000_000n);
  });

  it("parses an address", () => {
    const detail = addressResponseSchema.parse({
      asOf,
      address: A,
      isContract: true,
      label: "Zal canvas",
      txCount: 12,
      firstSeenBlock: "3",
      holdings: [{ token: tokenRef, balance: "7000000" }],
      nftCount: 2,
      canvas: { admin: B },
    });

    expect(detail.firstSeenBlock).toBe(3);
    expect(detail.holdings[0]?.balance).toBe(7_000_000n);
    expect(detail.canvas?.admin).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("parses a cursor page and its end", () => {
    const schema = pageSchema(txSummarySchema);

    expect(schema.parse({ asOf, items: [txSummary], next: "119:0" }).next).toBe(
      "119:0",
    );
    expect(schema.parse({ asOf, items: [], next: null }).next).toBeNull();
  });

  it("parses a token", () => {
    const { token } = tokenResponseSchema.parse({
      asOf,
      token: {
        address: ZUSDC,
        standard: "erc20",
        name: "Zal USD Coin",
        symbol: "zUSDC",
        decimals: 6,
        totalSupply: "1000000000000",
        holderCount: 5,
        transferCount: 40,
      },
    });

    expect(token.totalSupply).toBe(1_000_000_000_000n);
  });

  it("parses search results and rejects an unknown type", () => {
    const body = searchResponseSchema.parse({
      asOf,
      results: [{ type: "invoice", id: "12", label: "Invoice #12" }],
    });

    expect(body.results[0]?.type).toBe("invoice");
    expect(
      searchResponseSchema.safeParse({
        asOf,
        results: [{ type: "user", id: "x", label: null }],
      }).success,
    ).toBe(false);
  });

  it("parses charts: a UTC day number becomes unix seconds", () => {
    const charts = chartsResponseSchema.parse({
      asOf,
      days: [
        {
          day: 20_407,
          txCount: 10,
          activeAddresses: 4,
          gasUsed: "210000",
          fees: "5250000000000000",
          zusdcSettled: "5000000000",
          newAccounts: 1,
        },
      ],
      kinds: [
        { kind: "zal", count: 6 },
        { kind: "token", count: 4 },
      ],
    });

    expect(charts.days[0]?.day).toBe(20_407 * 86_400);
    expect(charts.days[0]?.zusdcSettled).toBe(5_000_000_000n);
  });

  it("rejects an amount that is not a decimal integer", () => {
    expect(
      txSummarySchema.safeParse({ ...txSummary, value: "1.5" }).success,
    ).toBe(false);
  });

  it("parses a stream block event and ignores junk", () => {
    expect(
      parseBlockEvent(
        JSON.stringify({
          number: 121,
          hash: HASH,
          timestamp: 1_763_000_002,
          txCount: 0,
          gasUsed: "0",
        }),
      )?.number,
    ).toBe(121);
    expect(parseBlockEvent("not json")).toBeUndefined();
  });
});
