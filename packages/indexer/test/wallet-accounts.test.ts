// GET /v1/wallets/:wallet/accounts: the canvases a wallet can open, from MemberSet (the canvas switcher's list), one
// bounded page at a time, because anyone can add any wallet as a member of as many canvases as they like.
import { describe, expect, test } from "vitest";

import { createHarness, type MemberFixture } from "./api-harness.ts";

const WALLET = "0x00000000000000000000000000000000000000aa";
const OWN = "0x00000000000000000000000000000000000acc01";
const CLUB = "0x00000000000000000000000000000000000acc02";
const SHOP = "0x00000000000000000000000000000000000acc03";
const REMOVED = "0x00000000000000000000000000000000000acc04";

describe("wallet accounts", () => {
  test("W1 lists every account where the wallet holds a role, with the role name, and leaves out removed ones", async () => {
    const h = await createHarness({
      [SHOP]: { [WALLET]: 1 },
      [OWN]: { [WALLET]: 3 },
      [CLUB]: { [WALLET]: 2 },
      [REMOVED]: { [WALLET]: 0 },
    });
    const res = await h.request("GET", `/v1/wallets/${WALLET.toUpperCase().replace("0X", "0x")}/accounts`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      asOf: { block: 7, updatedAt: 1_700_000_000 },
      wallet: WALLET,
      accounts: [
        { address: SHOP, role: "viewer", acted: false },
        { address: CLUB, role: "approver", acted: false },
        { address: OWN, role: "admin", acted: false },
      ],
      nextCursor: null,
    });
  });

  test("W2 a wallet with no role anywhere gets an empty list", async () => {
    const h = await createHarness({ [CLUB]: { "0x00000000000000000000000000000000000000bb": 3 } });
    const res = await h.request("GET", `/v1/wallets/${WALLET}/accounts`);
    expect(await res.json()).toMatchObject({ accounts: [] });
  });

  test("W3 a malformed wallet is a 400 problem", async () => {
    const h = await createHarness();
    const res = await h.request("GET", "/v1/wallets/0x123/accounts");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/problem+json");
  });

  test("W4 a page holds at most `limit` accounts (default 50, at most 100), and its cursor walks every one exactly once", async () => {
    const spam: Record<string, Record<string, MemberFixture>> = {};
    for (let i = 1; i <= 120; i++) {
      spam[`0x${i.toString(16).padStart(40, "0")}`] = { [WALLET]: { role: 3, acted: false, activeBlock: i } };
    }
    const h = await createHarness(spam);
    const page = async (query: string) => {
      const res = await h.request("GET", `/v1/wallets/${WALLET}/accounts${query}`);
      expect(res.status).toBe(200);
      return (await res.json()) as { accounts: { address: string }[]; nextCursor: string | null };
    };

    const first = await page("");
    expect(first.accounts).toHaveLength(50);
    // Newest activity first.
    expect(first.accounts[0]?.address).toBe(`0x${(120).toString(16).padStart(40, "0")}`);
    const seen = new Set(first.accounts.map((a) => a.address));
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const next = await page(`?cursor=${cursor}`);
      for (const a of next.accounts) {
        expect(seen.has(a.address)).toBe(false);
        seen.add(a.address);
      }
      cursor = next.nextCursor;
    }
    expect(seen.size).toBe(120);
    expect((await page("?limit=100")).accounts).toHaveLength(100);
    expect((await h.request("GET", `/v1/wallets/${WALLET}/accounts?limit=101`)).status).toBe(400);
    expect((await h.request("GET", `/v1/wallets/${WALLET}/accounts?limit=0`)).status).toBe(400);
    expect((await h.request("GET", `/v1/wallets/${WALLET}/accounts?cursor=nope`)).status).toBe(400);
  });

  test("W5 canvases the wallet acted on come first, newest activity first; `acted` keeps one group", async () => {
    const h = await createHarness({
      [OWN]: { [WALLET]: { role: 3, acted: true, activeBlock: 5 } },
      [CLUB]: { [WALLET]: { role: 2, acted: true, activeBlock: 9 } },
      [SHOP]: { [WALLET]: { role: 3, acted: false, activeBlock: 50 } },
    });
    const list = async (query: string) =>
      ((await (await h.request("GET", `/v1/wallets/${WALLET}/accounts${query}`)).json()) as {
        accounts: { address: string; acted: boolean }[];
      }).accounts;

    expect(await list("")).toEqual([
      { address: CLUB, role: "approver", acted: true },
      { address: OWN, role: "admin", acted: true },
      { address: SHOP, role: "admin", acted: false },
    ]);
    expect((await list("?acted=false")).map((a) => a.address)).toEqual([SHOP]);
    expect((await list("?acted=true")).map((a) => a.address)).toEqual([CLUB, OWN]);
  });

  test("W6 `q` keeps the accounts whose address contains it, with or without 0x, in any case", async () => {
    const h = await createHarness({ [OWN]: { [WALLET]: 3 }, [CLUB]: { [WALLET]: 2 } });
    const list = async (q: string) =>
      ((await (await h.request("GET", `/v1/wallets/${WALLET}/accounts?q=${q}`)).json()) as {
        accounts: { address: string }[];
      }).accounts.map((a) => a.address);

    expect(await list("ACC02")).toEqual([CLUB]);
    expect(await list("0x0000")).toEqual([CLUB, OWN]);
    expect((await h.request("GET", `/v1/wallets/${WALLET}/accounts?q=zz`)).status).toBe(400);
  });
});
