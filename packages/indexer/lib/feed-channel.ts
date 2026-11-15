// The Postgres NOTIFY channel the indexing handlers publish on and the SSE stream listens to, and the cursor both
// sides use. A notification only wakes the stream; the stream then reads the committed `feed` rows after its
// cursor, so a lost or early notification can delay an event but never drop one.

export const FEED_CHANNEL = "zal_feed";

export interface FeedCursor {
  readonly blockNumber: bigint;
  readonly logIndex: number;
}

/** The SSE event id and the Last-Event-ID a client sends back: `<blockNumber>-<logIndex>`. */
export const formatCursor = ({ blockNumber, logIndex }: FeedCursor): string => `${blockNumber}-${logIndex}`;

export function parseCursor(text: string | undefined): FeedCursor | undefined {
  const match = /^(\d{1,20})-(\d{1,9})$/.exec(text?.trim() ?? "");
  if (match?.[1] === undefined || match[2] === undefined) return undefined;
  return { blockNumber: BigInt(match[1]), logIndex: Number(match[2]) };
}


/** The `subject` of explorer block notices, which no account address can equal. */
export const EXPLORER_SUBJECT = "explorer";

/**
 * `feed`: indexing committed feed rows for `subject` up to `cursor`. `layout`: a member saved the account's layout
 * (zal_app.layouts) at `revision`, so other devices refetch it.
 */
export type FeedNotice =
  | { readonly kind: "feed"; readonly subject: string; readonly cursor: string }
  | { readonly kind: "layout"; readonly subject: string; readonly revision: number }
  /** The explorer indexed block `number` (subject {@link EXPLORER_SUBJECT}). */
  | { readonly kind: "block"; readonly subject: string; readonly number: string };

export const encodeNotice = (notice: FeedNotice): string => JSON.stringify(notice);

export function decodeNotice(payload: string): FeedNotice | undefined {
  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || !("kind" in value) || !("subject" in value)) return undefined;
    if (typeof value.subject !== "string") return undefined;
    if (value.kind === "feed" && "cursor" in value && typeof value.cursor === "string") {
      return { kind: "feed", subject: value.subject, cursor: value.cursor };
    }
    if (value.kind === "layout" && "revision" in value && typeof value.revision === "number") {
      return { kind: "layout", subject: value.subject, revision: value.revision };
    }
    if (value.kind === "block" && "number" in value && typeof value.number === "string" && /^\d{1,20}$/.test(value.number)) {
      return { kind: "block", subject: value.subject, number: value.number };
    }
  } catch {
    // A malformed payload is not ours.
  }
  return undefined;
}
