// Fixed facts of the sandbox. Nothing here loads the engine, so live mode can import it.

import { getContractAddress, type Address } from "viem";

import { localDeployConfig } from "@/contracts/deployments";

/** Its own chain id, so sandbox state can never be mistaken for the live L1 in caches or wallets. */
export const SANDBOX_CHAIN_ID = 7_357_001;

export const STORAGE_KEY_MODE = "zal.sandbox.mode.v1";
/** v2: the seed added the print shop, the co-signer and the wallet's LP cash, so v1 journals reseed. */
export const STORAGE_KEY_JOURNAL = "zal.sandbox.journal.v2";

/** The deployer, the same address Deploy.s.sol broadcasts from on a local anvil. */
export const SANDBOX_OWNER: Address = localDeployConfig.owner;
export const SANDBOX_KEEPER: Address = localDeployConfig.keeper;

/** Demo actors. The sandbox sends unsigned transactions, so these need no keys. */
export const SANDBOX_BOTS = {
  clubAdmin: "0x00000000000000000000000000000000000c1b01",
  clubTreasurer: "0x00000000000000000000000000000000000c1b02",
  lp: "0x000000000000000000000000000000000000f00d",
  /** Sells to the visitor: proposes a relationship and issues invoices to the visitor's account. */
  printShopAdmin: "0x0000000000000000000000000000000000005401",
  /** A second approver on the visitor's own account, so an M-of-N policy can be tried alone. */
  cosigner: "0x00000000000000000000000000000000000c0517",
  /** Runs every due schedule. Anyone may (ZR-SCH-05); this bot is "anyone". */
  keeper: "0x00000000000000000000000000000000000ee9e2",
} as const satisfies Record<string, Address>;

/** Seed amounts, USDC base units (6 decimals). Sandbox values, labelled as such in the UI. */
export const SANDBOX_SEED = {
  userAccount: 10_000_000_000n,
  clubAccount: 20_000_000_000n,
  lpDeposit: 50_000_000_000n,
  clubEventsBudget: 10_000_000_000n,
  /**
   * Credit line the pool owner gives the demo club, so an unescrowed invoice can be advanced too.
   * A sandbox value for showing both advance paths, not a calibrated limit.
   */
  clubObligorLimit: 20_000_000_000n,
  /** Testnet USDC in the visitor's wallet (not the account), for trying the LP role. */
  userWallet: 5_000_000_000n,
  printShopAccount: 1_000_000_000n,
  /** Face values the print shop invoices, in order, one at a time. */
  printShopInvoices: [1_200_000_000n, 800_000_000n, 450_000_000n],
  printShopDueDays: 14,
} as const;

/** Budget ids are numbers on-chain; their names are display labels. */
export const BUDGET_LABELS: Readonly<Record<string, string>> = {
  "1": "Events",
};

/** Display names of the sandbox actors' accounts and wallets. */
export const SANDBOX_NAMES = {
  club: "Demo club",
  printShop: "Demo print shop",
  cosigner: "Sandbox co-signer",
} as const;

/** How long a bot waits before it reacts, so a ghost stays visible long enough to be seen. */
export const BOT_DELAY_MS = 1_500;

const at = (nonce: number): Address =>
  getContractAddress({ from: SANDBOX_OWNER, nonce: BigInt(nonce) });

/**
 * The deployer's first six transactions create the protocol in Deploy.s.sol order, so every address is known
 * without loading the engine. The factory's own first CREATE is the CanvasAccount implementation.
 */
export const sandboxDeployment = {
  usdc: at(0),
  factory: at(1),
  registry: at(2),
  invoices: at(3),
  pool: at(4),
  vault: at(5),
  accountImplementation: getContractAddress({ from: at(1), nonce: 1n }),
  advanceRateBps: localDeployConfig.advanceRateBps,
  annualFeeBps: localDeployConfig.annualFeeBps,
} as const;
