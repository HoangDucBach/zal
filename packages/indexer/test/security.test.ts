// The trust-boundary checks: input the API must refuse with a 4xx before it touches the database or the chain.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { beforeEach, describe, expect, test } from "vitest";

import { CHAIN_ID, createHarness, REGISTRY, WEB_ORIGIN } from "./api-harness.ts";

const ACCOUNT = "0x00000000000000000000000000000000000acc01";
const PROPOSER = "0x00000000000000000000000000000000000acc02";
const member = privateKeyToAccount(generatePrivateKey());
const admin = privateKeyToAccount(generatePrivateKey());
const LAYOUT = { version: 1, positions: { account: { x: 0, y: 0 } }, children: [], drafts: [], links: [] };

let h: Awaited<ReturnType<typeof createHarness>>;
beforeEach(async () => {
  h = await createHarness({
    [ACCOUNT]: { [member.address.toLowerCase()]: 2 },
    [PROPOSER]: { [admin.address.toLowerCase()]: 3 },
  });
});

const put = (body: unknown, token?: string) => h.request("PUT", `/v1/accounts/${ACCOUNT}/layout`, body, token);

async function rawSiwe(lines: (nonce: string) => string) {
  const { nonce } = (await (await h.request("POST", "/v1/auth/nonce")).json()) as { nonce: string };
  const message = lines(nonce);
  return { nonce, message, signature: await member.signMessage({ message }) };
}
const siweText = (nonce: string, extra = "", o: { head?: string; uri?: string } = {}) =>
  `${o.head ?? new URL(WEB_ORIGIN).host} wants you to sign in with your Ethereum account:\n${member.address}\n\nSign in\n\nURI: ${o.uri ?? WEB_ORIGIN}\nVersion: 1\nChain ID: ${CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}${extra}`;

describe("sign-in", () => {
  test("A1 an unparseable Expiration Time is a 401 and does not burn the nonce or 500", async () => {
    const s = await rawSiwe((n) => siweText(n, "\nExpiration Time: never"));
    const res = await h.request("POST", "/v1/auth/verify", { message: s.message, signature: s.signature });
    const used = await h.pg.query<{ used_at: unknown }>("select used_at from zal_app.auth_nonces where nonce = $1", [s.nonce]);
    expect({ status: res.status, nonceUsed: used.rows[0]?.used_at !== null }).toEqual({ status: 401, nonceUsed: false });
  });

  test("A2 an unparseable Not Before is rejected, not ignored", async () => {
    const s = await rawSiwe((n) => siweText(n, "\nNot Before: 9999-99-99"));
    const res = await h.request("POST", "/v1/auth/verify", { message: s.message, signature: s.signature });
    expect(res.status).toBe(401);
  });
});

describe("layout", () => {
  test("L1 a layout Postgres jsonb cannot store (\\u0000) is a 400, not a 500", async () => {
    const token = await h.sessionFor(member);
    const res = await put({ layout: { ...LAYOUT, children: [{ id: "child-1", name: "a\u0000b", nodeIds: [] }] } }, token);
    expect(res.status).toBe(400);
  });

  test("L2 a revision beyond int4 is a 4xx, not a 500", async () => {
    const token = await h.sessionFor(member);
    expect((await put({ layout: LAYOUT, revision: 0 }, token)).status).toBe(200);
    const res = await put({ layout: LAYOUT, revision: 2 ** 40 }, token);
    expect([400, 409]).toContain(res.status);
  });

  test("L3 a write from revision 5 when nothing is saved is a 409", async () => {
    const token = await h.sessionFor(member);
    const res = await put({ layout: LAYOUT, revision: 5 }, token);
    expect(res.status).toBe(409);
  });
});

describe("invites", () => {
  async function signedInvite(nonce: string) {
    const message = {
      proposer: PROPOSER,
      proposerRole: 1,
      inviteeEmailHash: `0x${"cd".repeat(32)}`,
      nonce: BigInt(nonce),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 86_400),
    } as const;
    const signature = await admin.signTypedData({
      domain: { name: "Zal RelationshipRegistry", version: "1", chainId: CHAIN_ID, verifyingContract: REGISTRY },
      types: {
        Invite: [
          { name: "proposer", type: "address" },
          { name: "proposerRole", type: "uint8" },
          { name: "inviteeEmailHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint64" },
        ],
      },
      primaryType: "Invite",
      message,
    });
    return { ...message, nonce, deadline: Number(message.deadline), signature };
  }

  test("I1 the same on-chain invite (nonce 7 written 007) is not stored twice", async () => {
    const invite = await signedInvite("7");
    expect((await h.request("POST", "/v1/invites", invite)).status).toBe(201);
    const again = await h.request("POST", "/v1/invites", { ...invite, nonce: "007" });
    const rows = await h.pg.query<{ nonce: string }>("select nonce from zal_app.invites");
    expect({ status: again.status, stored: rows.rows.map((r) => r.nonce) }).toEqual({ status: 409, stored: ["7"] });
  });

  test("F2 an invite whose nonce acceptInvite already consumed on-chain is refused and not stored", async () => {
    const invite = await signedInvite("9");
    h.usedInviteNonces.add(`${PROPOSER}:9`);
    const res = await h.request("POST", "/v1/invites", invite);
    const rows = await h.pg.query("select id from zal_app.invites");
    expect({ status: res.status, stored: rows.rows.length }).toEqual({ status: 409, stored: 0 });
  });

  test("I2 a signature no key can have made (r = 0) is a 4xx, not a 500", async () => {
    const invite = await signedInvite("8");
    const res = await h.request("POST", "/v1/invites", { ...invite, signature: `0x${"00".repeat(32)}${"00".repeat(31)}01${"1b"}` });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("cleanup", () => {
  test("issuing a nonce deletes expired nonces, and signing in deletes expired sessions", async () => {
    await h.pg.query(
      "insert into zal_app.auth_nonces (nonce, chain_id, expires_at) values ('stale', $1, now() - interval '1 second')",
      [CHAIN_ID],
    );
    await h.pg.query(
      "insert into zal_app.sessions (token_hash, chain_id, wallet, expires_at) values ('stale', $1, 'w', now() - interval '1 second')",
      [CHAIN_ID],
    );
    await h.sessionFor(member);
    const nonces = await h.pg.query("select 1 from zal_app.auth_nonces where nonce = 'stale'");
    const sessions = await h.pg.query("select 1 from zal_app.sessions where token_hash = 'stale'");
    expect({ nonces: nonces.rows.length, sessions: sessions.rows.length }).toEqual({ nonces: 0, sessions: 0 });
  });
});
