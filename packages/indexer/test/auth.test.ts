// The write trust boundary: sign-in with a one-time nonce, then only members write a layout, and a
// wallet owns its notification read state.

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { beforeEach, describe, expect, test } from "vitest";

import { webOrigins } from "../lib/siwe.ts";
import { CHAIN_ID, createHarness, REGISTRY, WEB_ORIGINS } from "./api-harness.ts";

const ACCOUNT = "0x00000000000000000000000000000000000acc01";
const member = privateKeyToAccount(generatePrivateKey());
const outsider = privateKeyToAccount(generatePrivateKey());
const LAYOUT = { version: 1, positions: { account: { x: 0, y: 0 } }, children: [], drafts: [], links: [] };

let h: Awaited<ReturnType<typeof createHarness>>;

beforeEach(async () => {
  h = await createHarness({ [ACCOUNT]: { [member.address.toLowerCase()]: 2 } });
});

describe("sign-in", () => {
  test("a signed SIWE message over a fresh nonce opens a session for the signer", async () => {
    const res = await h.request("POST", "/v1/auth/verify", await h.signIn(member));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { token: string; wallet: string; asOf: unknown };
    expect(body.wallet).toBe(member.address.toLowerCase());
    expect(body.asOf).toEqual({ block: 7, updatedAt: 1_700_000_000 });

    const session = await h.request("GET", "/v1/auth/session", undefined, body.token);
    expect(await session.json()).toMatchObject({ wallet: member.address.toLowerCase() });
  });

  test("a replayed message is rejected: its nonce is already used", async () => {
    const signed = await h.signIn(member);
    expect((await h.request("POST", "/v1/auth/verify", signed)).status).toBe(201);
    const replay = await h.request("POST", "/v1/auth/verify", signed);
    expect(replay.status).toBe(401);
    const problem = (await replay.json()) as { code: string; detail: string };
    expect(problem.code).toBe("unauthorized");
    expect(problem.detail).toMatch(/already used/);
  });

  test("two concurrent verifies of one message open one session", async () => {
    const signed = await h.signIn(member);
    const statuses = await Promise.all([1, 2, 3].map(async () => h.request("POST", "/v1/auth/verify", signed)));
    expect(statuses.map((r) => r.status).sort()).toEqual([201, 401, 401]);
  });

  test("a nonce the server never issued is rejected", async () => {
    const { message, signature } = await h.signIn(member, { nonce: "neverissued0000000000000000000000" });
    expect((await h.request("POST", "/v1/auth/verify", { message, signature })).status).toBe(401);
  });

  test("a message for another site or chain is rejected", async () => {
    for (const overrides of [{ domain: "evil.example" }, { chainId: 1 }, { uri: "https://evil.example" }]) {
      const res = await h.request("POST", "/v1/auth/verify", await h.signIn(member, overrides));
      expect(res.status, JSON.stringify(overrides)).toBe(401);
    }
  });

  test("every allowed web origin can sign in", async () => {
    for (const origin of WEB_ORIGINS) {
      const signed = await h.signIn(member, { domain: new URL(origin).host, uri: origin });
      expect((await h.request("POST", "/v1/auth/verify", signed)).status, origin).toBe(201);
    }
  });

  test("an origin outside the allow-list is rejected, however close to an entry", async () => {
    for (const origin of ["http://localhost:3002", "https://localhost:3100", "http://127.0.0.1:3100"]) {
      const signed = await h.signIn(member, { domain: new URL(origin).host, uri: origin });
      expect((await h.request("POST", "/v1/auth/verify", signed)).status, origin).toBe(401);
    }
  });

  test("domain and URI must name the same allowed origin, not one entry each", async () => {
    const [docker, dev] = WEB_ORIGINS;
    for (const [domain, uri] of [[new URL(docker).host, dev], [new URL(dev).host, docker]]) {
      const res = await h.request("POST", "/v1/auth/verify", await h.signIn(member, { domain, uri }));
      expect(res.status, `${domain} with ${uri}`).toBe(401);
    }
  });

  test("ZAL_WEB_ORIGIN parses a comma-separated list to origins and refuses wildcards and empty lists", () => {
    expect(webOrigins.parse(" http://localhost:3100 , http://localhost:3001/app ,")).toEqual([
      "http://localhost:3100",
      "http://localhost:3001",
    ]);
    for (const bad of ["", " , ", "*", "http://localhost:3100,*", "localhost:3001"]) {
      expect(webOrigins.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  test("a signature by another key is rejected", async () => {
    const { message } = await h.signIn(member);
    const signature = await outsider.signMessage({ message });
    expect((await h.request("POST", "/v1/auth/verify", { message, signature })).status).toBe(401);
  });

  test("signing out ends the session", async () => {
    const token = await h.sessionFor(member);
    expect((await h.request("DELETE", "/v1/auth/session", undefined, token)).status).toBe(204);
    expect((await h.request("GET", "/v1/auth/session", undefined, token)).status).toBe(401);
  });
});

describe("layout writes", () => {
  const put = (body: unknown, token?: string) => h.request("PUT", `/v1/accounts/${ACCOUNT}/layout`, body, token);

  test("without a session the write is refused", async () => {
    expect((await put({ layout: LAYOUT })).status).toBe(401);
    expect((await put({ layout: LAYOUT }, "not-a-token")).status).toBe(401);
  });

  test("a signed-in wallet that is not a member cannot write the layout", async () => {
    const res = await put({ layout: LAYOUT }, await h.sessionFor(outsider));
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
    expect(await res.json()).toMatchObject({ code: "forbidden" });
    const rows = await h.pg.query("select * from zal_app.layouts");
    expect(rows.rows).toEqual([]);
  });

  test("a viewer cannot write the layout: only approvers and admins edit it, as the canvas allows", async () => {
    const viewer = privateKeyToAccount(generatePrivateKey());
    const admin = privateKeyToAccount(generatePrivateKey());
    h = await createHarness({
      [ACCOUNT]: { [member.address.toLowerCase()]: 2, [viewer.address.toLowerCase()]: 1, [admin.address.toLowerCase()]: 3 },
    });
    expect((await put({ layout: LAYOUT, revision: 0 }, await h.sessionFor(admin))).status).toBe(200);
    const refused = await put({ layout: LAYOUT, revision: 1 }, await h.sessionFor(viewer));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "forbidden" });
    const rows = await h.pg.query<{ revision: number; updated_by: string }>(
      "select revision, updated_by from zal_app.layouts",
    );
    expect(rows.rows).toEqual([{ revision: 1, updated_by: admin.address.toLowerCase() }]);
    expect((await put({ layout: LAYOUT, revision: 1 }, await h.sessionFor(member))).status).toBe(200);
  });

  test("a member writes, and a write from a stale revision gets 409", async () => {
    const token = await h.sessionFor(member);
    const first = await put({ layout: LAYOUT, revision: 0 }, token);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ layout: { revision: 1, updatedBy: member.address.toLowerCase() } });

    expect((await put({ layout: LAYOUT, revision: 1 }, token)).status).toBe(200);
    const stale = await put({ layout: LAYOUT, revision: 1 }, token);
    expect(stale.status).toBe(409);
    expect((await put({ layout: LAYOUT }, token)).status).toBe(200);
  });

  test("a malformed or oversized layout is refused before it is stored", async () => {
    const token = await h.sessionFor(member);
    const bad = await put({ layout: { ...LAYOUT, version: 2 } }, token);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ errors: [expect.objectContaining({ path: "layout.version" })] });
    const huge = { ...LAYOUT, children: [{ id: "child-1", name: "x".repeat(300_000), nodeIds: [] }] };
    expect((await put({ layout: huge }, token)).status).toBe(413);
  });
});

describe("notification read state", () => {
  const key = `0x${"ab".repeat(32)}:3`;

  test("is written for the signed-in wallet only", async () => {
    expect((await h.request("POST", "/v1/notifications/read", { keys: [key] })).status).toBe(401);
    const token = await h.sessionFor(outsider);
    expect((await h.request("POST", "/v1/notifications/read", { keys: [key, key] }, token)).status).toBe(200);
    const rows = await h.pg.query<{ wallet: string; key: string; chain_id: number }>(
      "select wallet, key, chain_id from zal_app.notification_reads",
    );
    expect(rows.rows).toEqual([{ wallet: outsider.address.toLowerCase(), key, chain_id: CHAIN_ID }]);
  });
});

describe("invites", () => {
  const PROPOSER = "0x00000000000000000000000000000000000acc02";

  async function signedInvite(signer: typeof member, nonce: string) {
    const message = {
      proposer: PROPOSER,
      proposerRole: 1,
      inviteeEmailHash: `0x${"cd".repeat(32)}`,
      nonce: BigInt(nonce),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 86_400),
    } as const;
    const signature = await signer.signTypedData({
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

  test("an admin's signed invite gets a link that reads back; a non-admin's does not", async () => {
    const admin = privateKeyToAccount(generatePrivateKey());
    h = await createHarness({ [PROPOSER]: { [admin.address.toLowerCase()]: 3, [member.address.toLowerCase()]: 2 } });

    const created = await h.request("POST", "/v1/invites", await signedInvite(admin, "1"));
    expect(created.status).toBe(201);
    const { invite } = (await created.json()) as { invite: { id: string; signer: string } };
    expect(created.headers.get("Location")).toBe(`/v1/invites/${invite.id}`);
    expect(invite.signer).toBe(admin.address.toLowerCase());

    const read = await h.request("GET", `/v1/invites/${invite.id}`);
    expect(await read.json()).toMatchObject({ invite: { id: invite.id, proposer: PROPOSER, nonce: "1", expired: false } });

    expect((await h.request("POST", "/v1/invites", await signedInvite(admin, "1"))).status).toBe(409);
    expect((await h.request("POST", "/v1/invites", await signedInvite(member, "2"))).status).toBe(403);
    expect((await h.request("GET", "/v1/invites/unknown")).status).toBe(404);
  });

  test("a high-s signature the chain would refuse gets no link", async () => {
    const admin = privateKeyToAccount(generatePrivateKey());
    h = await createHarness({ [PROPOSER]: { [admin.address.toLowerCase()]: 3 } });
    const invite = await signedInvite(admin, "7");
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    const s = BigInt(`0x${invite.signature.slice(66, 130)}`);
    const v = invite.signature.slice(130) === "1b" ? "1c" : "1b";
    const malleable = `${invite.signature.slice(0, 66)}${(n - s).toString(16).padStart(64, "0")}${v}`;
    const res = await h.request("POST", "/v1/invites", { ...invite, signature: malleable });
    expect(res.status).toBe(400);
  });
});

describe("abuse limits", () => {
  test("a large body is refused on routes other than the layout", async () => {
    const res = await h.request("POST", "/v1/auth/verify", { message: "x".repeat(70_000), signature: "0x00" });
    expect(res.status).toBe(413);
  });

  test("a malformed signature is a 401, not a server error", async () => {
    const { message } = await h.signIn(member);
    expect((await h.request("POST", "/v1/auth/verify", { message, signature: "0x00" })).status).toBe(401);
  });

  test("a session ends no later than the expiry the wallet signed", async () => {
    const expirationTime = new Date(Date.now() + 120_000);
    const res = await h.request("POST", "/v1/auth/verify", await h.signIn(member, { expirationTime }));
    const { expiresAt } = (await res.json()) as { expiresAt: string };
    expect(Math.abs(new Date(expiresAt).getTime() - expirationTime.getTime())).toBeLessThan(1_000);
  });

  test("a wallet keeps only its newest 5000 read keys", async () => {
    const token = await h.sessionFor(member);
    for (let batch = 0; batch < 11; batch++) {
      const keys = Array.from({ length: 500 }, (_, i) => `0x${"ab".repeat(32)}:${batch * 500 + i}`);
      expect((await h.request("POST", "/v1/notifications/read", { keys }, token)).status).toBe(200);
    }
    const count = await h.pg.query<{ n: number }>("select count(*)::int as n from zal_app.notification_reads");
    expect(count.rows[0]?.n).toBe(5_000);
  });
});
