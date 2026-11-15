// RelationshipRegistry events. `acceptInvite` emits Proposed then Accepted, so it needs no handler of its own.

import { ponder } from "ponder:registry";
import schema from "ponder:schema";

import { publish } from "./feed.ts";

const STATUS = { proposed: 1, active: 2, rejected: 3, cancelled: 4 } as const;

ponder.on("RelationshipRegistry:RelationshipProposed", async ({ event, context }) => {
  const { id, buyer, seller, proposer, expiresAt } = event.args;
  await context.db.insert(schema.relationship).values({
    id,
    buyer,
    seller,
    proposer,
    proposedAt: event.block.timestamp,
    expiresAt,
    status: STATUS.proposed,
  });
  await publish(context, event, "RelationshipProposed", [buyer, seller], { relationshipId: id });
});

for (const [name, status] of [
  ["RelationshipAccepted", STATUS.active],
  ["RelationshipRejected", STATUS.rejected],
  ["RelationshipCancelled", STATUS.cancelled],
] as const) {
  ponder.on(`RelationshipRegistry:${name}`, async ({ event, context }) => {
    const { id, buyer, seller } = event.args;
    await context.db.update(schema.relationship, { id }).set({ status });
    await publish(context, event, name, [buyer, seller], { relationshipId: id });
  });
}
