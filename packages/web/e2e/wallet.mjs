// An injected EIP-1193 wallet for Playwright that signs with a real private key (viem) and sends to anvil.
// Each browser context gets its own key, so SIWE, EIP-712 invites and transactions are real signatures.
import { createWalletClient, defineChain, http } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/** The anvil the web build talks to: `RPC`, or the host port docker compose maps (`ZAL_ANVIL_PORT`, default 8545). */
export const RPC = process.env.RPC ?? `http://localhost:${process.env.ZAL_ANVIL_PORT ?? 8545}`;
const chain = defineChain({
  id: 31337,
  name: "anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

export async function rpc(method, params = []) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
  return body.result;
}

const toBig = (types, primary, value) => {
  const fields = types[primary] ?? [];
  const out = { ...value };
  for (const { name, type } of fields) {
    if (/^u?int\d*$/.test(type)) out[name] = BigInt(value[name]);
    else if (types[type]) out[name] = toBig(types, type, value[name]);
  }
  return out;
};

/** A funded wallet: a fresh key unless one is given. */
export async function makeWallet(privateKey = generatePrivateKey(), { log = () => {} } = {}) {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain, transport: http(RPC) });
  await rpc("anvil_setBalance", [account.address, "0x56BC75E2D63100000"]);
  const calls = [];
  async function handle(method, params) {
    calls.push(method);
    switch (method) {
      case "eth_requestAccounts":
      case "eth_accounts":
        return [account.address];
      case "eth_chainId":
        return "0x7a69";
      case "net_version":
        return "31337";
      case "wallet_switchEthereumChain":
      case "wallet_addEthereumChain":
        return null;
      case "wallet_requestPermissions":
      case "wallet_getPermissions":
        return [{ parentCapability: "eth_accounts" }];
      case "personal_sign":
        log(`sign message (${account.address.slice(0, 8)})`);
        return account.signMessage({ message: { raw: params[0] } });
      case "eth_signTypedData_v4": {
        const typed = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
        const { EIP712Domain: _, ...types } = typed.types;
        log(`sign typed data ${typed.primaryType}`);
        return account.signTypedData({
          domain: { ...typed.domain, chainId: Number(typed.domain.chainId) },
          types,
          primaryType: typed.primaryType,
          message: toBig(types, typed.primaryType, typed.message),
        });
      }
      case "eth_sendTransaction": {
        const tx = params[0];
        log(`send tx to ${tx.to}`);
        return client.sendTransaction({
          to: tx.to,
          data: tx.data,
          value: tx.value === undefined ? undefined : BigInt(tx.value),
          gas: tx.gas === undefined ? undefined : BigInt(tx.gas),
        });
      }
      default:
        return rpc(method, params);
    }
  }
  return { address: account.address, privateKey, handle, calls };
}

/** A browser context whose page has `window.ethereum` backed by `wallet`. */
export async function contextWith(browser, wallet, { viewport = { width: 1440, height: 900 }, name = "page" } = {}) {
  const ctx = await browser.newContext({ viewport });
  const logs = [];
  if (wallet !== undefined) {
    await ctx.exposeFunction("__zalWallet", async (method, params) => {
      try {
        return { result: (await wallet.handle(method, params ?? [])) ?? null };
      } catch (error) {
        return { error: { message: error.shortMessage ?? error.message, code: error.code ?? -32603, data: error.data } };
      }
    });
    await ctx.addInitScript(() => {
      const listeners = {};
      window.ethereum = {
        isMetaMask: false,
        async request({ method, params }) {
          const answer = await window.__zalWallet(method, params ?? []);
          if (answer.error) throw Object.assign(new Error(answer.error.message), answer.error);
          return answer.result;
        },
        on(event, fn) { (listeners[event] ??= []).push(fn); },
        removeListener(event, fn) { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); },
      };
    });
  }
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && logs.push(`${name} console: ${m.text().split("\n")[0]}`));
  page.on("pageerror", (e) => logs.push(`${name} pageerror: ${e.message.split("\n")[0]}`));
  return { ctx, page, logs };
}
