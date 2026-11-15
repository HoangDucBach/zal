import type { CanvasRows, FeedRow, InvoiceRow } from "../lib/canvas.ts";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { assembleCanvas, requiredNow, toWire } from "../lib/canvas.ts";
import { asOfFromCheckpoint } from "../lib/checkpoint.ts";
import { decodeNotice, encodeNotice, formatCursor, parseCursor } from "../lib/feed-channel.ts";
import { readDeployment } from "../lib/deployment.ts";
import { layoutSchema } from "../lib/layout.ts";
import { deriveNotifications, NOTIFICATION_KINDS } from "../lib/notifications.ts";

const WEB = join(import.meta.dirname, "..", "..", "web", "lib");
const MIRROR = join(import.meta.dirname, "..", "lib", "web-mirror");
const read = (path: string) => readFileSync(path, "utf8");

describe("the web mirror has not drifted from packages/web", () => {
  test.each(["types.ts", "activity.ts", "layout-access.ts"])("lib/canvas/%s is copied byte for byte", (file) => {
    expect(read(join(MIRROR, file))).toBe(read(join(WEB, "canvas", file)));
  });

  test("the notification kinds are the web's six", () => {
    const web = /NOTIFICATION_KINDS = \[([^\]]*)\]/.exec(read(join(WEB, "canvas", "notifications.ts")))?.[1];
    expect(web?.match(/"(\w+)"/g)?.map((k) => k.slice(1, -1))).toEqual([...NOTIFICATION_KINDS]);
  });

  test("the stored layout accepts every palette component the web can place", () => {
    const components = [...read(join(WEB, "canvas", "palette.ts")).matchAll(/\{ component: "(\w+)"/g)].map((m) => m[1]);
    expect(components.length).toBeGreaterThan(10);
    for (const component of components) {
      const parsed = layoutSchema.safeParse({
        version: 1,
        positions: {},
        children: [],
        drafts: [{ id: "draft-1", component }],
      });
      expect(parsed.success, String(component)).toBe(true);
    }
  });
});

const SELLER = "0x00000000000000000000000000000000000000a1";
const BUYER = "0x00000000000000000000000000000000000000b2";
const KEEPER = "0x00000000000000000000000000000000000000c3";
const TX = `0x${"11".repeat(32)}` as const;

const invoice: InvoiceRow = {
  id: 1n,
  relationshipId: 1n,
  seller: SELLER,
  buyer: BUYER,
  faceValue: 5_000_000_000n,
  escrowed: 0n,
  issuedAt: 100n,
  dueDate: 200n,
  approvedAt: 150n,
  status: 3,
  docHash: `0x${"AB".repeat(32)}`,
  owner: SELLER,
};

const feedRow = (name: string, logIndex: number, refs: Partial<FeedRow> = {}): FeedRow => ({
  name,
  blockNumber: 10n,
  logIndex,
  transactionHash: TX,
  timestamp: 1_000n,
  relationshipId: null,
  invoiceId: null,
  opId: null,
  budgetId: null,
  scheduleId: null,
  actor: null,
  ...refs,
});

function rows(address: string, feed: readonly FeedRow[]): CanvasRows {
  return {
    wallet: SELLER,
    address: address as `0x${string}`,
    account: { address: address as `0x${string}`, threshold: 1, approvalLimit: 0n, policyNonce: 1n, endpointPublic: true, windowStart: 0n, windowSpent: 0n, route: [] },
    members: [{ wallet: SELLER, role: 3 }],
    budgets: [],
    charges: [],
    ops: [],
    confirmedByWallet: new Set(),
    schedules: [],
    relationships: [],
    invoices: [invoice],
    advances: new Map([[1n, { principal: 4_000_000_000n, fee: 50_000_000n, fundedAt: 160n }]]),
    obligors: new Map(),
    pool: { address: "0x00000000000000000000000000000000000000d4", idleCash: 1n, totalAssets: 2n, advanceRateBps: 8000, annualFeeBps: 1521 },
    balances: { accountUsdc: 9n, accountVaultShares: 0n, walletPoolShares: 0n, walletUsdc: 0n, walletPoolAllowance: 0n },
    views: { vaultAssets: 0n, lpAssets: 0n, lpMaxWithdraw: 0n },
    feed,
    transfers: [],
    routed: [],
    now: 1_000,
  };
}

describe("canvas assembly", () => {
  test("the wire form has decimal-string amounts and lowercase hex", () => {
    const wire = toWire(assembleCanvas(rows(SELLER, []), 0)) as {
      invoices: { faceValue: string; docHash: string; advance: { principal: string }; owner: string }[];
      account: { myRole: string; balance: string };
    };
    expect(wire.invoices[0]).toMatchObject({
      faceValue: "5000000000",
      docHash: `0x${"ab".repeat(32)}`,
      advance: { principal: "4000000000" },
    });
    expect(wire.account).toMatchObject({ myRole: "admin", balance: "9" });
  });

  test("a payment and an advance are news for the seller, not for the buyer", () => {
    const feed = [
      feedRow("Advanced", 1, { invoiceId: 1n }),
      feedRow("InvoicePaid", 2, { invoiceId: 1n, actor: KEEPER }),
    ];
    expect(deriveNotifications(assembleCanvas(rows(SELLER, feed), 0)).map((n) => n.kind).sort()).toEqual([
      "advancePaid",
      "paymentReceived",
    ]);
    expect(deriveNotifications(assembleCanvas(rows(BUYER, feed), 0))).toEqual([]);
  });
});

describe("feed cursor and notices", () => {
  test("a cursor round-trips, and garbage is not a cursor", () => {
    expect(parseCursor(formatCursor({ blockNumber: 12n, logIndex: 3 }))).toEqual({ blockNumber: 12n, logIndex: 3 });
    for (const bad of ["", "12", "a-1", "1-2-3", undefined]) expect(parseCursor(bad)).toBeUndefined();
  });

  test("notices round-trip and foreign payloads are ignored", () => {
    for (const n of [
      { kind: "feed", subject: SELLER, cursor: "1-0" },
      { kind: "layout", subject: SELLER, revision: 4 },
    ] as const) {
      expect(decodeNotice(encodeNotice(n))).toEqual(n);
    }
    for (const bad of ["{", "null", '{"kind":"feed","subject":1}', '{"kind":"other","subject":"x"}']) {
      expect(decodeNotice(bad)).toBeUndefined();
    }
  });

  test("asOf comes from Ponder's checkpoint: block timestamp and block number", () => {
    const checkpoint = `1700000000${"31337".padStart(16, "0")}${"42".padStart(16, "0")}${"0".repeat(33)}`;
    expect(asOfFromCheckpoint(checkpoint)).toEqual({ block: 42, updatedAt: 1_700_000_000 });
  });
});

describe("deployment config", () => {
  const env = { ZAL_CHAIN_ID: "31337", ZAL_RPC_URL: "http://anvil:8545", ZAL_DEPLOYMENT: "/d/local.json" };
  const file = read(join(import.meta.dirname, "..", "..", "contracts", "deployments", "local.json"));

  test("reads addresses from the deployment file, lowercased", () => {
    const d = readDeployment(env, () => file);
    expect(d).toMatchObject({ chainId: 31337, startBlock: 0 });
    expect(d.addresses.factory).toBe("0xe7f1725e7734ce288f8367e1bb143e90bb3f0512");
  });

  test("refuses a deployment file for another chain", () => {
    expect(() => readDeployment({ ...env, ZAL_CHAIN_ID: "43114" }, () => file)).toThrow(/is for chain 31337/);
  });
});

describe("requiredNow (ADR 0016, ZR-ACC-11)", () => {
  const acc = {
    address: "0x00000000000000000000000000000000000000a1" as const,
    threshold: 2,
    approvalLimit: 1_000n,
    policyNonce: 3n,
    endpointPublic: false,
    windowStart: 10_000n,
    windowSpent: 600n,
    route: [],
  };
  const pending = { opId: 1n, data: "0x" as const, amount: 600n, policyNonce: 3n, required: 2, confirmations: 1, executed: false };

  test("keeps the threshold while the window holds the earlier spend", () => {
    expect(requiredNow(acc, pending, 10_000 + 86_399)).toBe(2);
  });

  test("drops to one confirmation once the window has expired", () => {
    expect(requiredNow(acc, pending, 10_000 + 86_400)).toBe(1);
  });

  test("needs the threshold above the limit even in an empty window", () => {
    expect(requiredNow(acc, { ...pending, amount: 1_001n }, 10_000 + 86_400)).toBe(2);
  });

  test("keeps the submitted count for stale and executed ops", () => {
    expect(requiredNow(acc, { ...pending, policyNonce: 2n }, 10_000 + 86_400)).toBe(2);
    expect(requiredNow(acc, { ...pending, executed: true }, 10_000 + 86_400)).toBe(2);
  });
});
