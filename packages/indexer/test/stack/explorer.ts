// Checks every /v1/explorer route against the running docker stack and the chain itself. Run after demo.ts (as
// `test:stack` does), so the chain holds Zal traffic: accounts, zUSDC moves, an Invoice NFT and its payment. It
// sends one native transfer of its own and waits for it on the explorer stream.

import assert from "node:assert/strict";

import { createPublicClient, createWalletClient, http, parseEther, toHex, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import { zalInvoiceAbi, zusdcAbi } from "../../abis/index.ts";
import { readDeployment } from "../../lib/deployment.ts";

const API = `${process.env.ZAL_API_URL ?? "http://localhost:42069"}/v1/explorer`;
const RPC = process.env.ZAL_RPC_URL ?? "http://localhost:8545";
const DEPLOYMENT = new URL("../../../contracts/deployments/local.json", import.meta.url).pathname;
const d = readDeployment({ ZAL_CHAIN_ID: "31337", ZAL_RPC_URL: RPC, ZAL_DEPLOYMENT: DEPLOYMENT }).addresses;
const chain = { ...foundry, rpcUrls: { default: { http: [RPC] } } };
const client = createPublicClient({ chain, transport: http(RPC) });

interface Page<T> {
  asOf: { block: number };
  items: T[];
  next: string | null;
}
interface TxSummary {
  hash: Hex;
  blockNumber: string;
  timestamp: number;
  from: Address;
  to: Address | null;
  value: string;
  fee: string;
  status: string;
  method: string | null;
  selector: Hex | null;
  kind: string;
}
interface TokenRef {
  address: Address;
  symbol: string | null;
  decimals: number | null;
  standard: string;
}
interface Transfer {
  txHash: Hex;
  logIndex: number;
  token: TokenRef;
  from: Address;
  to: Address;
  value: string | null;
  tokenId: string | null;
}

async function get<T>(path: string): Promise<{ status: number; type: string | null; body: T }> {
  const res = await fetch(`${API}${path}`);
  return { status: res.status, type: res.headers.get("content-type"), body: (await res.json()) as T };
}
async function ok<T>(path: string): Promise<T> {
  const res = await get<T>(path);
  assert.equal(res.status, 200, `GET ${path} answered ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}

async function until<T>(label: string, check: () => Promise<T | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check().catch(() => undefined);
    if (value !== undefined && value !== false) return value;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${label}`);
}

/** Every item of a list, following `next`, checking that pages never repeat an item. */
async function walk<T>(path: string, keyOf: (item: T) => string, limit = 7): Promise<T[]> {
  const all: T[] = [];
  const seen = new Set<string>();
  let before: string | null = null;
  for (let i = 0; i < 1_000; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const page: Page<T> = await ok(`${path}${sep}limit=${limit}${before === null ? "" : `&before=${before}`}`);
    assert.ok(page.items.length <= limit);
    for (const item of page.items) {
      assert.ok(!seen.has(keyOf(item)), `${path} repeats ${keyOf(item)}`);
      seen.add(keyOf(item));
      all.push(item);
    }
    if (page.next === null) return all;
    before = page.next;
  }
  throw new Error(`${path} never ended`);
}

/** Reads `event: block` messages from the explorer stream until `close()`. */
function openBlockStream() {
  const blocks: { id: string; number: string; hash: string }[] = [];
  const controller = new AbortController();
  const done = (async () => {
    const res = await fetch(`${API}/stream`, { signal: controller.signal });
    assert.equal(res.headers.get("content-type")?.startsWith("text/event-stream"), true);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) return;
      buffer += value;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const fields = Object.fromEntries(
          buffer
            .slice(0, end)
            .split("\n")
            .filter((line) => !line.startsWith(":"))
            .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()]),
        ) as Record<string, string>;
        buffer = buffer.slice(end + 2);
        if (fields.event === "block" && fields.data !== undefined) {
          blocks.push({ id: fields.id ?? "", ...(JSON.parse(fields.data) as { number: string; hash: string }) });
        }
      }
    }
  })().catch((error: unknown) => {
    if (!controller.signal.aborted) throw error;
  });
  return {
    blocks,
    close: async () => {
      controller.abort();
      await done;
    },
  };
}

const log = (step: string) => console.log(`ok  ${step}`);

async function main() {
  const start = await client.getBlockNumber();
  await until("explorer caught up", async () => BigInt((await ok<{ height: string }>("/stats")).height) >= start);

  // A native transfer between two fresh wallets, seen on the stream and on every view of it.
  const stream = openBlockStream();
  await new Promise((r) => setTimeout(r, 300));
  const sender = privateKeyToAccount(generatePrivateKey());
  const recipient = privateKeyToAccount(generatePrivateKey()).address.toLowerCase() as Address;
  await client.request({ method: "anvil_setBalance" as never, params: [sender.address, toHex(10n ** 18n)] as never });
  const wallet = createWalletClient({ account: sender, chain, transport: http(RPC) });
  const hash = await wallet.sendTransaction({ to: recipient, value: parseEther("0.25") });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const pushed = await until("block on the stream", () =>
    Promise.resolve(stream.blocks.find((b) => BigInt(b.number) === receipt.blockNumber)),
  );
  assert.equal(pushed.hash, receipt.blockHash.toLowerCase());
  assert.equal(pushed.id, receipt.blockNumber.toString(), "the SSE id is the block number");
  await stream.close();
  log(`stream: block ${pushed.number} arrived as event: block`);

  const { tx, logs, transfers } = await ok<{ tx: TxSummary & { index: number; gasUsed: string; effectiveGasPrice: string; input: Hex }; logs: unknown[]; transfers: unknown[] }>(
    `/txs/${hash}`,
  );
  assert.equal(tx.kind, "native");
  assert.equal(tx.status, "success");
  assert.equal(tx.value, parseEther("0.25").toString());
  assert.equal(tx.from, sender.address.toLowerCase());
  assert.equal(tx.to, recipient);
  assert.equal(tx.blockNumber, receipt.blockNumber.toString());
  assert.equal(tx.gasUsed, receipt.gasUsed.toString());
  assert.equal(tx.fee, (receipt.gasUsed * receipt.effectiveGasPrice).toString());
  assert.equal(tx.selector, null);
  assert.equal(tx.input, "0x");
  assert.deepEqual([logs.length, transfers.length], [0, 0]);
  log(`tx ${hash}: native, fee ${tx.fee} matches the receipt`);

  const rpcBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
  for (const id of [rpcBlock.number.toString(), rpcBlock.hash]) {
    const { block, txs } = await ok<{ block: { hash: Hex; parentHash: Hex; gasUsed: string; miner: Address; txCount: number }; txs: TxSummary[] }>(`/blocks/${id}`);
    assert.equal(block.hash, rpcBlock.hash.toLowerCase());
    assert.equal(block.parentHash, rpcBlock.parentHash.toLowerCase());
    assert.equal(block.gasUsed, rpcBlock.gasUsed.toString());
    assert.equal(block.txCount, rpcBlock.transactions.length);
    assert.ok(txs.some((t) => t.hash === hash.toLowerCase()));
  }
  log(`block ${rpcBlock.number} by number and by hash matches the chain`);

  const to = await ok<{ isContract: boolean; txCount: number; firstSeenBlock: string; label: string | null; canvas: unknown }>(`/address/${recipient}`);
  assert.deepEqual([to.isContract, to.txCount, to.firstSeenBlock, to.label, to.canvas], [false, 1, receipt.blockNumber.toString(), null, null]);
  const sent = await ok<Page<TxSummary>>(`/address/${sender.address}/txs`);
  assert.deepEqual(sent.items.map((t) => t.hash), [hash.toLowerCase()]);
  log("address: the recipient is an EOA first seen in that block, the sender lists its one tx");

  // Totals against the chain, and every list walked page by page. The keeper may add blocks meanwhile, so
  // everything is compared up to the height the stats were read at.
  const head = await client.getBlockNumber();
  await until("explorer at the chain head", async () => BigInt((await ok<{ height: string }>("/stats")).height) >= head);
  const stats = await ok<{ height: string; totalTxs: number; totalAddresses: number; totalContracts: number; zusdcSupply: string; canvases: number; avgBlockTimeSec: number | null }>("/stats");
  const height = BigInt(stats.height);
  let chainTxs = 0;
  for (let n = 0n; n <= height; n++) chainTxs += await client.getBlockTransactionCount({ blockNumber: n });
  assert.equal(stats.totalTxs, chainTxs, "totalTxs counts every transaction on the chain");
  const supply = await client.readContract({ address: d.usdc, abi: zusdcAbi, functionName: "totalSupply", blockNumber: height });
  assert.equal(stats.zusdcSupply, supply.toString());
  assert.ok(stats.canvases >= 2 && stats.totalContracts >= 6 + stats.canvases);
  const blocks = (await walk<{ number: string }>("/blocks", (b) => b.number, 25)).filter((b) => BigInt(b.number) <= height);
  assert.equal(blocks.length, Number(height) + 1, "one block per height from genesis");
  assert.deepEqual(blocks.map((b) => b.number), [...blocks].map((b) => b.number).sort((x, y) => Number(y) - Number(x)));
  const txs = (await walk<TxSummary>("/txs", (t) => t.hash)).filter((t) => BigInt(t.blockNumber) <= height);
  assert.equal(txs.length, chainTxs, "paging /txs reaches every transaction once");
  log(`stats: height ${stats.height}, ${stats.totalTxs} txs, ${stats.totalAddresses} addresses, ${stats.canvases} canvases; /blocks and /txs walked`);

  // Tokens: zUSDC metadata and holders against balanceOf; the Invoice NFT and its status.
  // Holder balances are compared at the block the explorer read them at.
  const usdc = await ok<{ token: { symbol: string; decimals: number; standard: string; totalSupply: string; holderCount: number } }>(`/tokens/${d.usdc}`);
  assert.deepEqual([usdc.token.symbol, usdc.token.decimals, usdc.token.standard], ["zUSDC", 6, "erc20"]);
  const holders = await until("holders at one block", async () => {
    const at = (await ok<{ asOf: { block: number } }>("/stats")).asOf.block;
    const list = await walk<{ holder: Address; balance: string }>(`/tokens/${d.usdc}/holders`, (h) => h.holder, 5);
    const after = (await ok<{ asOf: { block: number } }>("/stats")).asOf.block;
    return at === after ? { at: BigInt(at), list } : undefined;
  });
  const holderBlock = holders.at;
  const supplyAt = await client.readContract({ address: d.usdc, abi: zusdcAbi, functionName: "totalSupply", blockNumber: holderBlock });
  assert.equal(holders.list.reduce((s, h) => s + BigInt(h.balance), 0n), supplyAt, "holders sum to totalSupply");
  for (const h of holders.list) {
    const onChain = await client.readContract({ address: d.usdc, abi: zusdcAbi, functionName: "balanceOf", args: [h.holder], blockNumber: holderBlock });
    assert.equal(h.balance, onChain.toString(), `zUSDC balance of ${h.holder}`);
  }
  assert.ok(holders.list.every((h, i) => i === 0 || BigInt(holders.list[i - 1]!.balance) >= BigInt(h.balance)), "largest first");
  assert.ok(usdc.token.holderCount > 0);
  const tokenList = await walk<{ address: Address }>("/tokens", (t) => t.address, 2);
  assert.ok(tokenList.some((t) => t.address === d.usdc) && tokenList.some((t) => t.address === d.invoices));
  const usdcTransfers = await walk<Transfer>(`/tokens/${d.usdc}/transfers`, (t) => `${t.txHash}:${t.logIndex}`, 10);
  assert.ok(usdcTransfers.every((t) => t.token.symbol === "zUSDC" && t.value !== null && t.tokenId === null));
  log(`tokens: zUSDC ${holders.list.length} holders sum to totalSupply and match balanceOf; ${usdcTransfers.length} transfers`);

  const invoiceHolders = await ok<Page<{ holder: Address; balance: string }>>(`/tokens/${d.invoices}/holders`);
  const nftOwner = invoiceHolders.items[0]!.holder;
  const nfts = await ok<Page<{ token: TokenRef; tokenId: string; invoice: { status: string; faceValue: string; dueDate: number } | null }>>(`/address/${nftOwner}/nfts`);
  assert.ok(nfts.items.length > 0);
  for (const nft of nfts.items) {
    assert.equal(nft.token.standard, "erc721");
    const owner = await client.readContract({ address: d.invoices, abi: zalInvoiceAbi, functionName: "ownerOf", args: [BigInt(nft.tokenId)] });
    assert.equal(owner.toLowerCase(), nftOwner);
    assert.ok(nft.invoice !== null && ["issued", "approved", "paid", "rejected", "cancelled"].includes(nft.invoice.status));
  }
  const ownerView = await ok<{ nftCount: number; holdings: { token: TokenRef }[] }>(`/address/${nftOwner}`);
  assert.ok(ownerView.nftCount >= nfts.items.length);
  assert.ok(ownerView.holdings.some((h) => h.token.address === d.invoices));
  const ownerTransfers = await walk<Transfer>(`/address/${nftOwner}/transfers`, (t) => `${t.txHash}:${t.logIndex}`, 3);
  assert.ok(ownerTransfers.every((t) => t.from === nftOwner || t.to === nftOwner));
  log(`nfts: ${nftOwner} holds invoice #${nfts.items[0]!.tokenId} (${nfts.items[0]!.invoice!.status}); its transfers page`);

  const zalTx = txs.find((t) => t.kind === "zal" && t.method !== null)!;
  const zalDetail = await ok<{ logs: { decoded: { name: string } | null }[] }>(`/txs/${zalTx.hash}`);
  assert.ok(zalDetail.logs.length > 0 && zalDetail.logs.every((l) => l.decoded !== null), "Zal logs decode");
  const factory = await ok<{ label: string; isContract: boolean }>(`/address/${d.factory}`);
  assert.deepEqual([factory.label, factory.isContract], ["ZalFactory", true]);
  log(`zal: ${zalTx.method} decoded with ${zalDetail.logs.length} decoded logs; the factory is labelled`);

  // Search.
  const search = async (q: string) => (await ok<{ results: { type: string; id: string }[] }>(`/search?q=${encodeURIComponent(q)}`)).results;
  assert.deepEqual((await search(hash)).map((r) => r.type), ["tx"]);
  assert.deepEqual(await search(rpcBlock.hash), [{ type: "block", id: rpcBlock.number.toString(), label: `Block ${rpcBlock.number}` }]);
  assert.equal((await search(rpcBlock.number.toString()))[0]?.type, "block");
  assert.equal((await search(recipient.toUpperCase().replace("0X", "0x")))[0]?.id, recipient);
  assert.deepEqual((await search(d.usdc)).map((r) => r.type), ["token", "address"]);
  assert.deepEqual((await search(`#${nfts.items[0]!.tokenId}`)).map((r) => r.type), ["invoice"]);
  assert.ok((await search("zus")).some((r) => r.type === "token" && r.id === d.usdc));
  assert.ok((await search("ZalFact")).some((r) => r.type === "address" && r.id === d.factory));
  assert.deepEqual(await search("%"), []);
  assert.deepEqual(await search("99999999"), []);
  log("search: tx, block hash, block number, address, token, invoice, name prefix");

  // Charts.
  for (const [range, days] of [["1d", 1], ["1w", 7], ["1m", 30]] as const) {
    assert.equal((await ok<{ days: unknown[] }>(`/charts?range=${range}`)).days.length, days);
  }
  type Charts = { asOf: { block: number }; days: { day: number; txCount: number }[]; kinds: { kind: string; count: number }[] };
  // Charts and stats read at the same indexed block agree on the total.
  const [all, total] = await until("charts and stats at one block", async () => {
    const before = await ok<{ asOf: { block: number }; totalTxs: number }>("/stats");
    const charts = await ok<Charts>("/charts?range=all");
    return charts.asOf.block === before.asOf.block ? ([charts, before.totalTxs] as const) : undefined;
  });
  assert.equal(all.days.reduce((s, d) => s + d.txCount, 0), total);
  assert.equal(all.kinds.reduce((s, k) => s + k.count, 0), total);
  assert.deepEqual(all.kinds.map((k) => k.kind), ["zal", "token", "native", "deploy", "other"]);
  log(`charts: ${all.days.length} days, kinds ${all.kinds.map((k) => `${k.kind} ${k.count}`).join(", ")}`);

  // Errors: RFC 9457 problems.
  const zero = `0x${"0".repeat(63)}1`;
  for (const [path, status] of [
    ["/blocks?limit=0", 400],
    ["/blocks?limit=101", 400],
    ["/txs?before=nope", 400],
    [`/txs?before=${Buffer.from("1").toString("base64url")}`, 400],
    ["/blocks/abc", 400],
    ["/txs/0x12", 400],
    ["/address/0xnot", 400],
    ["/charts?range=2y", 400],
    [`/search?q=${"x".repeat(201)}`, 400],
    [`/txs/${zero}`, 404],
    ["/blocks/99999999", 404],
    [`/address/0x${"de".repeat(20)}`, 404],
    [`/address/0x${"de".repeat(20)}/txs`, 404],
    [`/tokens/${recipient}`, 404],
    [`/tokens/${recipient}/holders`, 404],
  ] as const) {
    const res = await get<{ code: string; status: number }>(path);
    assert.equal(res.status, status, `${path} answers ${status}`);
    assert.equal(res.type, "application/problem+json");
    assert.equal(res.body.status, status);
  }
  log("errors: malformed input is 400, unknown ids are 404, both as problem+json");
}

await main();
console.log("\nexplorer stack test passed");
