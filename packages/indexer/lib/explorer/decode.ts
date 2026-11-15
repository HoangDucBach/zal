// Names for calldata and logs from the Zal ABIs. Anything the Zal ABIs do not describe stays undecoded, and the
// explorer shows the raw selector or topics.

import {
  decodeEventLog,
  toEventSelector,
  toFunctionSelector,
  type Abi,
  type AbiEvent,
  type Hex,
} from "viem";

import {
  canvasAccountAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
  zalVaultAbi,
  zusdcAbi,
} from "../../abis/index.ts";

const ZAL_ABIS: readonly Abi[] = [
  zusdcAbi,
  zalFactoryAbi,
  canvasAccountAbi,
  relationshipRegistryAbi,
  zalInvoiceAbi,
  zalFundingPoolAbi,
  zalVaultAbi,
];

const methodBySelector = new Map<string, string>();
/** Several events share a topic (ERC-20 and ERC-721 `Transfer`), so each topic keeps every candidate. */
const eventsByTopic = new Map<string, AbiEvent[]>();
for (const abi of ZAL_ABIS) {
  for (const item of abi) {
    if (item.type === "function") {
      methodBySelector.set(toFunctionSelector(item), item.name);
    } else if (item.type === "event") {
      const topic = toEventSelector(item);
      const list = eventsByTopic.get(topic) ?? [];
      const signature = JSON.stringify(item.inputs);
      if (!list.some((e) => JSON.stringify(e.inputs) === signature)) list.push(item);
      eventsByTopic.set(topic, list);
    }
  }
}

/** The Zal function name for a 4-byte selector, or null. */
export const methodName = (selector: Hex | null): string | null =>
  selector === null ? null : (methodBySelector.get(selector.toLowerCase()) ?? null);

export interface DecodedLog {
  readonly name: string;
  readonly args: Record<string, string>;
}

/** Arg values as text: bigints in decimal, hex lowercase, arrays and structs as JSON of the same. */
function argText(value: unknown): string {
  if (typeof value === "string") return /^0x[0-9a-fA-F]*$/.test(value) ? value.toLowerCase() : value;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? v.toString() : typeof v === "string" && /^0x[0-9a-fA-F]*$/.test(v) ? v.toLowerCase() : v,
  );
}

/** Decodes a log with the Zal event ABIs, or returns null when none of them fits its topics and data. */
export function decodeZalLog(topics: readonly Hex[], data: Hex): DecodedLog | null {
  const [topic0] = topics;
  if (topic0 === undefined) return null;
  for (const event of eventsByTopic.get(topic0.toLowerCase()) ?? []) {
    try {
      const decoded = decodeEventLog({
        abi: [event],
        topics: topics as [Hex, ...Hex[]],
        data,
        strict: true,
      });
      const raw: unknown = decoded.args;
      const entries: [string, unknown][] = Array.isArray(raw)
        ? raw.map((v, i) => [event.inputs[i]?.name || String(i), v])
        : Object.entries((raw ?? {}) as Record<string, unknown>);
      return { name: event.name, args: Object.fromEntries(entries.map(([k, v]) => [k, argText(v)])) };
    } catch {
      // This candidate's indexed layout does not fit the log; the next candidate may.
    }
  }
  return null;
}
