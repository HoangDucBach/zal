// Pure rules the explorer's block handler applies to a block's transactions and logs: which logs are token
// transfers, what kind a transaction is, and how a block adds to its UTC day. No I/O, so the rules are unit-tested.

import { keccak256, toBytes, type Address, type Hex } from "viem";

export const TX_KINDS = ["zal", "token", "native", "deploy", "other"] as const;
export type TxKind = (typeof TX_KINDS)[number];

export const SECONDS_PER_DAY = 86_400;

/** The label of each deployment contract, by its key in the deployment file. */
export const DEPLOYMENT_NAMES = {
  usdc: "zUSDC",
  factory: "ZalFactory",
  registry: "RelationshipRegistry",
  invoices: "ZalInvoice",
  pool: "ZalFundingPool",
  vault: "ZalVault",
} as const;

/** The label of every Zal CanvasAccount. */
export const CANVAS_LABEL = "Zal canvas";

/** `Transfer(address,address,uint256)`: the same topic for ERC-20 (value in data) and ERC-721 (tokenId indexed). */
export const TRANSFER_TOPIC = keccak256(toBytes("Transfer(address,address,uint256)"));

export interface RawLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
  readonly logIndex: number;
}

export type TokenTransfer =
  | { readonly standard: "erc20"; readonly token: Address; readonly from: Address; readonly to: Address; readonly value: bigint }
  | { readonly standard: "erc721"; readonly token: Address; readonly from: Address; readonly to: Address; readonly tokenId: bigint };

const WORD = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;

const topicAddress = (topic: Hex): Address => `0x${topic.slice(26).toLowerCase()}`;

/**
 * A `Transfer` log with 3 topics and a 32-byte value is ERC-20; with 4 topics and no data it is ERC-721. Anything
 * else under the same topic (a malformed or non-standard event) is not a transfer.
 */
export function classifyTransfer(log: RawLog): TokenTransfer | undefined {
  const [topic0, fromTopic, toTopic, idTopic] = log.topics;
  if (topic0?.toLowerCase() !== TRANSFER_TOPIC || fromTopic === undefined || toTopic === undefined) return undefined;
  if (!ADDRESS_TOPIC.test(fromTopic) || !ADDRESS_TOPIC.test(toTopic)) return undefined;
  const token = log.address.toLowerCase() as Address;
  const from = topicAddress(fromTopic);
  const to = topicAddress(toTopic);
  if (log.topics.length === 3 && WORD.test(log.data)) return { standard: "erc20", token, from, to, value: BigInt(log.data) };
  if (log.topics.length === 4 && idTopic !== undefined && WORD.test(idTopic) && log.data === "0x") {
    return { standard: "erc721", token, from, to, tokenId: BigInt(idTopic) };
  }
  return undefined;
}

export interface KindInput {
  /** Null on a contract creation. */
  readonly to: Address | null;
  /** `to` is a Zal contract or a Zal canvas. */
  readonly toZal: boolean;
  readonly hasTokenTransfer: boolean;
  readonly input: Hex;
  readonly value: bigint;
}

/** In order: a creation, a call into Zal, a token move, a plain native send, anything else. */
export function txKind(tx: KindInput): TxKind {
  if (tx.to === null) return "deploy";
  if (tx.toZal) return "zal";
  if (tx.hasTokenTransfer) return "token";
  if (tx.input === "0x" && tx.value > 0n) return "native";
  return "other";
}

/** The UTC unix day of a block timestamp in seconds. */
export const dayOf = (timestamp: bigint | number): number => Math.floor(Number(timestamp) / SECONDS_PER_DAY);

/** First 4 bytes of calldata, or null when there are fewer. */
export const selectorOf = (input: Hex): Hex | null =>
  input.length >= 10 ? (input.slice(0, 10).toLowerCase() as Hex) : null;

export interface DayTx {
  readonly from: Address;
  readonly to: Address | null;
  readonly kind: TxKind;
  readonly gasUsed: bigint;
  readonly fee: bigint;
}

export interface DayDelta {
  readonly txCount: number;
  readonly gasUsed: bigint;
  readonly fees: bigint;
  readonly kinds: Readonly<Record<TxKind, number>>;
  /** Distinct senders and recipients, lowercase. */
  readonly addresses: readonly Address[];
}

/** What a block's transactions add to their day. Active addresses are distinct `from` and `to`. */
export function aggregateDay(txs: readonly DayTx[]): DayDelta {
  const kinds = Object.fromEntries(TX_KINDS.map((k) => [k, 0])) as Record<TxKind, number>;
  const addresses = new Set<Address>();
  let gasUsed = 0n;
  let fees = 0n;
  for (const tx of txs) {
    kinds[tx.kind] += 1;
    gasUsed += tx.gasUsed;
    fees += tx.fee;
    addresses.add(tx.from.toLowerCase() as Address);
    if (tx.to !== null) addresses.add(tx.to.toLowerCase() as Address);
  }
  return { txCount: txs.length, gasUsed, fees, kinds, addresses: [...addresses] };
}

/** A token's name or symbol as stored: printable text only, at most 64 characters, null when nothing is left. */
export function cleanTokenText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
  return text === "" ? null : text;
}
