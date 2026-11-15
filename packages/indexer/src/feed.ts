// Writes one `feed` row per subject an event concerns, marks the sending wallet as active on each subject it is a
// member of, and publishes the row on the NOTIFY channel. Indexing files import this; it registers no handlers itself.

import type { Context } from "ponder:registry";

import { sql } from "ponder";
import schema from "ponder:schema";

import { encodeNotice, FEED_CHANNEL, formatCursor } from "../lib/feed-channel.ts";

interface LoggedEvent {
  readonly block: { readonly number: bigint; readonly timestamp: bigint };
  readonly log: { readonly logIndex: number };
  readonly transaction: { readonly hash: `0x${string}`; readonly from: `0x${string}` };
}

/** Where an event sits, as `member.activeBlock` and `member.activeLogIndex`. */
export const activeAt = (event: LoggedEvent) => ({ activeBlock: event.block.number, activeLogIndex: event.log.logIndex });

interface FeedRefs {
  readonly relationshipId?: bigint;
  readonly invoiceId?: bigint;
  readonly opId?: bigint;
  readonly budgetId?: bigint;
  readonly actor?: `0x${string}`;
}

export async function publish(
  context: Context,
  event: LoggedEvent,
  name: string,
  subjects: readonly `0x${string}`[],
  refs: FeedRefs = {},
): Promise<void> {
  const cursor = { blockNumber: event.block.number, logIndex: event.log.logIndex };
  for (const subject of new Set(subjects.map((s) => s.toLowerCase() as `0x${string}`))) {
    await context.db
      .insert(schema.feed)
      .values({
        subject,
        blockNumber: cursor.blockNumber,
        logIndex: cursor.logIndex,
        name,
        transactionHash: event.transaction.hash,
        timestamp: event.block.timestamp,
        relationshipId: refs.relationshipId ?? null,
        invoiceId: refs.invoiceId ?? null,
        opId: refs.opId ?? null,
        budgetId: refs.budgetId ?? null,
        actor: refs.actor ?? null,
      })
      .onConflictDoNothing();
    // The sender is a member who acted on this account: its canvas leaves the switcher's "added by others" group.
    const sender = { account: subject, wallet: event.transaction.from.toLowerCase() as `0x${string}` };
    if ((await context.db.find(schema.member, sender)) !== null) {
      await context.db.update(schema.member, sender).set({ acted: true, ...activeAt(event) });
    }
    // Inside the indexing transaction, so Postgres delivers it only after the rows above commit.
    await context.db.sql.execute(
      sql`select pg_notify(${FEED_CHANNEL}, ${encodeNotice({ kind: "feed", subject, cursor: formatCursor(cursor) })})`,
    );
  }
}
