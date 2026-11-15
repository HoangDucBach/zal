// The explorer's block handler (docs/plans/explorer.md): every block, with its transactions and receipts, into the
// ex_* tables, then a NOTIFY for /v1/explorer/stream. Ponder runs block events after the block's log events, so the
// Zal tables it reads (account, schedule) are already up to date for this block.

import type { Context } from "ponder:registry";

import { sql } from "ponder";
import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import {
  decodeEventLog,
  erc20Abi,
  erc721Abi,
  formatTransactionReceipt,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";

import { canvasAccountAbi, zalFactoryAbi, zalInvoiceAbi } from "../abis/index.ts";
import {
  aggregateDay,
  CANVAS_LABEL,
  classifyTransfer,
  DEPLOYMENT_NAMES,
  cleanTokenText,
  dayOf,
  selectorOf,
  txKind,
  type DayTx,
  type TokenTransfer,
} from "../lib/explorer/chain.ts";
import { methodName } from "../lib/explorer/decode.ts";
import { encodeNotice, EXPLORER_SUBJECT, FEED_CHANNEL } from "../lib/feed-channel.ts";

const lower = (a: string) => a.toLowerCase() as Address;

/** Running totals this block adds to ex_totals. */
interface Totals {
  txCount: bigint;
  addressCount: bigint;
  contractCount: bigint;
  canvasCount: bigint;
}

/** The deployment's contracts by address, with the names the explorer labels them with. */
function deploymentLabels(context: Context): Map<Address, string> {
  const c = context.contracts;
  return new Map([
    [lower(c.ZUSDC.address), DEPLOYMENT_NAMES.usdc],
    [lower(c.ZalFactory.address), DEPLOYMENT_NAMES.factory],
    [lower(c.RelationshipRegistry.address), DEPLOYMENT_NAMES.registry],
    [lower(c.ZalInvoice.address), DEPLOYMENT_NAMES.invoices],
    [lower(c.ZalFundingPool.address), DEPLOYMENT_NAMES.pool],
    [lower(c.ZalVault.address), DEPLOYMENT_NAMES.vault],
  ]);
}

/**
 * The block's receipts in one `eth_getBlockReceipts`. A node without it (or one that answers short) gets one
 * `eth_getTransactionReceipt` per transaction instead.
 */
async function blockReceipts(context: Context, number: bigint, hashes: readonly Hex[]): Promise<TransactionReceipt[]> {
  try {
    const raw = await context.client.request({ method: "eth_getBlockReceipts", params: [toHex(number)] });
    if (Array.isArray(raw) && raw.length === hashes.length) return raw.map((r) => formatTransactionReceipt(r));
  } catch (error) {
    console.warn(`explorer: eth_getBlockReceipts failed for block ${number}, reading receipts one by one`, error);
  }
  return Promise.all(hashes.map((hash) => context.client.getTransactionReceipt({ hash })));
}

/** name, symbol and (ERC-20) decimals at this block. A read that fails leaves its field null, as the plan says. */
async function tokenMetadata(context: Context, token: Address, standard: TokenTransfer["standard"]) {
  const abi = standard === "erc20" ? erc20Abi : erc721Abi;
  const read = async (functionName: "name" | "symbol" | "decimals"): Promise<unknown> => {
    try {
      return await context.client.readContract({ address: token, abi: abi as typeof erc20Abi, functionName, retryEmptyResponse: false });
    } catch {
      // Not every token implements the optional metadata; a missing value is shown as unknown.
      return null;
    }
  };
  const [name, symbol, decimals] = await Promise.all([
    read("name"),
    read("symbol"),
    standard === "erc20" ? read("decimals") : Promise.resolve(null),
  ]);
  return {
    name: cleanTokenText(name),
    symbol: cleanTokenText(symbol),
    decimals: typeof decimals === "number" && decimals <= 255 ? decimals : null,
  };
}

class BlockWriter {
  readonly totals: Totals = { txCount: 0n, addressCount: 0n, contractCount: 0n, canvasCount: 0n };

  constructor(
    private readonly context: Context,
    private readonly blockNumber: bigint,
    private readonly labels: Map<Address, string>,
  ) {}

  private async isCanvas(address: Address) {
    return (await this.context.db.find(schema.account, { address })) !== null;
  }

  /** `to` is a Zal contract or a Zal canvas. */
  async isZal(to: Address | null) {
    return to !== null && (this.labels.has(to) || (await this.isCanvas(to)));
  }

  /**
   * Records that the address took part in this block. `contract` is known proof that it has code (it emitted a
   * log, was created, or is a canvas); without it a new non-sender address is checked with `eth_getCode`.
   */
  async touch(address: Address, opts: { txParty?: boolean; sender?: boolean; contract?: boolean; canvas?: boolean } = {}) {
    if (address === zeroAddress) return;
    const db = this.context.db;
    const label = this.labels.get(address) ?? (opts.canvas === true ? CANVAS_LABEL : undefined);
    const known = opts.contract === true || label !== undefined;
    const row = await db.find(schema.exAddress, { address });
    if (row === null) {
      const isContract =
        known || (opts.sender !== true && ((await this.context.client.getCode({ address })) ?? "0x") !== "0x");
      await db.insert(schema.exAddress).values({
        address,
        firstSeenBlock: this.blockNumber,
        txCount: opts.txParty === true ? 1 : 0,
        isContract,
        label: label ?? null,
      });
      this.totals.addressCount += 1n;
      if (isContract) this.totals.contractCount += 1n;
      return;
    }
    const becomesContract = known && !row.isContract;
    if (becomesContract) this.totals.contractCount += 1n;
    if (opts.txParty === true || becomesContract || (label !== undefined && row.label === null)) {
      await db.update(schema.exAddress, { address }).set({
        txCount: row.txCount + (opts.txParty === true ? 1 : 0),
        isContract: row.isContract || known,
        label: row.label ?? label ?? null,
      });
    }
  }

  async transfer(t: TokenTransfer, tx: { hash: Hex; logIndex: number; timestamp: bigint }) {
    const db = this.context.db;
    const amount = t.standard === "erc20" ? t.value : 1n;
    let token = await db.find(schema.exToken, { address: t.token });
    if (token === null) {
      token = await db.insert(schema.exToken).values({
        address: t.token,
        standard: t.standard,
        ...(await tokenMetadata(this.context, t.token, t.standard)),
        totalSupply: 0n,
        holderCount: 0,
        transferCount: 0,
      });
    }
    await this.touch(t.token, { contract: true });
    let holderDelta = 0;
    for (const [holder, delta] of [
      [t.from, -amount],
      [t.to, amount],
    ] as const) {
      if (holder === zeroAddress) continue;
      await this.touch(holder);
      const current = (await db.find(schema.exHolding, { token: t.token, holder }))?.balance ?? 0n;
      const next = current + delta;
      if (current <= 0n && next > 0n) holderDelta += 1;
      if (current > 0n && next <= 0n) holderDelta -= 1;
      if (next <= 0n) await db.delete(schema.exHolding, { token: t.token, holder });
      else await db.insert(schema.exHolding).values({ token: t.token, holder, balance: next }).onConflictDoUpdate({ balance: next });
    }
    const minted = t.from === zeroAddress ? amount : 0n;
    const burned = t.to === zeroAddress ? amount : 0n;
    await db.update(schema.exToken, { address: t.token }).set({
      totalSupply: token.totalSupply + minted - burned,
      holderCount: token.holderCount + holderDelta,
      transferCount: token.transferCount + 1,
    });
    await db.insert(schema.exTransfer).values({
      txHash: tx.hash,
      logIndex: tx.logIndex,
      blockNumber: this.blockNumber,
      timestamp: tx.timestamp,
      token: t.token,
      from: t.from,
      to: t.to,
      value: t.standard === "erc20" ? t.value : null,
      tokenId: t.standard === "erc721" ? t.tokenId : null,
    });
    if (t.standard === "erc721") {
      const owner = t.to === zeroAddress ? null : t.to;
      await db
        .insert(schema.exNft)
        .values({ token: t.token, tokenId: t.tokenId, owner, mintedBlock: this.blockNumber })
        .onConflictDoUpdate({ owner });
    }
  }

  /** zUSDC this log settles: an invoice's face value, or a Transfer schedule's payment. */
  async settled(log: TransactionReceipt["logs"][number]): Promise<bigint> {
    const emitter = lower(log.address);
    const topics = log.topics as [Hex, ...Hex[]];
    if (emitter === lower(this.context.contracts.ZalInvoice.address)) {
      const decoded = tryDecode(() => decodeEventLog({ abi: zalInvoiceAbi, topics, data: log.data }));
      return decoded?.eventName === "InvoicePaid" ? decoded.args.faceValue : 0n;
    }
    const decoded = tryDecode(() => decodeEventLog({ abi: canvasAccountAbi, topics, data: log.data }));
    if (decoded?.eventName !== "ScheduleRan" || !(await this.isCanvas(emitter))) return 0n;
    // A PayInvoice schedule's payment is already counted by its InvoicePaid.
    const schedule = await this.context.db.find(schema.schedule, { account: emitter, scheduleId: decoded.args.id });
    return schedule?.kind === 0 ? decoded.args.amountPaid : 0n;
  }

  /** The canvas a factory `AccountCreated` log announces, or undefined. */
  accountCreated(log: TransactionReceipt["logs"][number]): Address | undefined {
    if (lower(log.address) !== lower(this.context.contracts.ZalFactory.address)) return undefined;
    const decoded = tryDecode(() =>
      decodeEventLog({ abi: zalFactoryAbi, topics: log.topics, data: log.data }),
    );
    return decoded?.eventName === "AccountCreated" ? lower(decoded.args.account) : undefined;
  }
}

/** Decodes with a Zal ABI; a log of another shape under a shared topic is simply not that event. */
function tryDecode<T>(decode: () => T): T | undefined {
  try {
    return decode();
  } catch {
    return undefined;
  }
}

ponder.on("Explorer:block", async ({ event, context }) => {
  const number = event.block.number;
  const timestamp = event.block.timestamp;
  const block = await context.client.getBlock({ blockNumber: number, includeTransactions: true });
  const txs = block.transactions;
  const receipts = txs.length === 0 ? [] : await blockReceipts(context, number, txs.map((t) => t.hash));
  const receiptByHash = new Map(receipts.map((r) => [r.transactionHash.toLowerCase(), r]));
  const writer = new BlockWriter(context, number, deploymentLabels(context));
  const db = context.db;

  const dayTxs: DayTx[] = [];
  let settled = 0n;
  let newAccounts = 0;

  for (const tx of txs) {
    const receipt = receiptByHash.get(tx.hash.toLowerCase());
    if (receipt === undefined) throw new Error(`explorer: no receipt for ${tx.hash} in block ${number}`);
    const from = lower(tx.from);
    const to = tx.to === null || tx.to === undefined ? null : lower(tx.to);
    const created = receipt.contractAddress === null || receipt.contractAddress === undefined ? null : lower(receipt.contractAddress);
    const transfers = receipt.logs.flatMap((log) => {
      const t = classifyTransfer({ address: log.address, topics: log.topics, data: log.data, logIndex: log.logIndex });
      return t === undefined ? [] : [{ transfer: t, logIndex: log.logIndex }];
    });

    await writer.touch(from, { txParty: true, sender: true });
    if (to !== null && to !== from) await writer.touch(to, { txParty: true });
    if (created !== null) await writer.touch(created, { contract: true });
    for (const log of receipt.logs) {
      const canvas = writer.accountCreated(log);
      if (canvas !== undefined) {
        await writer.touch(canvas, { contract: true, canvas: true });
        writer.totals.canvasCount += 1n;
        newAccounts += 1;
      }
    }

    const selector = selectorOf(tx.input);
    const fee = receipt.gasUsed * receipt.effectiveGasPrice;
    const kind = txKind({
      to,
      toZal: await writer.isZal(to),
      hasTokenTransfer: transfers.length > 0,
      input: tx.input,
      value: tx.value,
    });
    await db.insert(schema.exTx).values({
      hash: lower(tx.hash),
      blockNumber: number,
      index: tx.transactionIndex ?? receipt.transactionIndex,
      timestamp,
      from,
      to,
      value: tx.value,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
      fee,
      status: receipt.status === "success" ? "success" : "reverted",
      selector,
      method: methodName(selector),
      contractCreated: created,
      kind,
      input: tx.input.toLowerCase() as Hex,
    });
    for (const log of receipt.logs) {
      await db.insert(schema.exLog).values({
        txHash: lower(tx.hash),
        logIndex: log.logIndex,
        blockNumber: number,
        address: lower(log.address),
        topics: log.topics.map((t) => t.toLowerCase() as Hex),
        data: log.data.toLowerCase() as Hex,
      });
      settled += await writer.settled(log);
    }
    for (const { transfer, logIndex } of transfers) {
      await writer.transfer(transfer, { hash: lower(tx.hash), logIndex, timestamp });
    }
    dayTxs.push({ from, to, kind, gasUsed: receipt.gasUsed, fee });
  }
  writer.totals.txCount += BigInt(txs.length);

  await db.insert(schema.exBlock).values({
    number,
    hash: lower(block.hash),
    parentHash: lower(block.parentHash),
    timestamp,
    txCount: txs.length,
    gasUsed: block.gasUsed,
    gasLimit: block.gasLimit,
    baseFeePerGas: block.baseFeePerGas ?? null,
    miner: lower(block.miner),
  });

  if (txs.length > 0 || settled > 0n || newAccounts > 0) {
    const day = dayOf(timestamp);
    const delta = aggregateDay(dayTxs);
    let fresh = 0;
    for (const address of delta.addresses) {
      if ((await db.find(schema.exDailyAddress, { day, address })) !== null) continue;
      await db.insert(schema.exDailyAddress).values({ day, address });
      fresh += 1;
    }
    const row = await db.find(schema.exDaily, { day });
    const base = row ?? {
      txCount: 0, activeAddresses: 0, gasUsed: 0n, fees: 0n, zusdcSettled: 0n, newAccounts: 0,
      zalTxs: 0, tokenTxs: 0, nativeTxs: 0, deployTxs: 0, otherTxs: 0,
    };
    const next = {
      txCount: base.txCount + delta.txCount,
      activeAddresses: base.activeAddresses + fresh,
      gasUsed: base.gasUsed + delta.gasUsed,
      fees: base.fees + delta.fees,
      zusdcSettled: base.zusdcSettled + settled,
      newAccounts: base.newAccounts + newAccounts,
      zalTxs: base.zalTxs + delta.kinds.zal,
      tokenTxs: base.tokenTxs + delta.kinds.token,
      nativeTxs: base.nativeTxs + delta.kinds.native,
      deployTxs: base.deployTxs + delta.kinds.deploy,
      otherTxs: base.otherTxs + delta.kinds.other,
    };
    if (row === null) await db.insert(schema.exDaily).values({ day, ...next });
    else await db.update(schema.exDaily, { day }).set(next);
  }

  const t = writer.totals;
  await db
    .insert(schema.exTotals)
    .values({ id: 1, ...t })
    .onConflictDoUpdate((row) => ({
      txCount: row.txCount + t.txCount,
      addressCount: row.addressCount + t.addressCount,
      contractCount: row.contractCount + t.contractCount,
      canvasCount: row.canvasCount + t.canvasCount,
    }));

  // Inside the indexing transaction, so listeners hear of the block only after its rows commit.
  await db.sql.execute(
    sql`select pg_notify(${FEED_CHANNEL}, ${encodeNotice({ kind: "block", subject: EXPLORER_SUBJECT, number: number.toString() })})`,
  );
});
