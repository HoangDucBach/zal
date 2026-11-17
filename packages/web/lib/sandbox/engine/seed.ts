// Deploys the protocol with the same wiring as packages/contracts/script/Deploy.s.sol, then seeds the demo:
// - the visitor's CanvasAccount funded with zUSDC, with a sandbox co-signer as its second approver;
// - testnet USDC in the visitor's wallet, for the LP role;
// - a club canvas with two signers and an Events budget that buys from the visitor;
// - a print shop canvas that sells to the visitor and has already proposed that relationship;
// - an LP deposit in the funding pool.
// Demo partners (../partners.ts) are seeded later, on demand, with the same buyer and seller recipes.

import type { SandboxChain } from "./chain";

import {
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  zeroHash,
  type Abi,
  type Address,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type Hex,
} from "viem";

import {
  SANDBOX_BOTS,
  SANDBOX_KEEPER,
  SANDBOX_OWNER,
  SANDBOX_SEED,
  sandboxDeployment as d,
} from "../config";
import {
  partnerAdmin,
  partnerName,
  readDemoPartners,
  type DemoPartner,
  type PartnerRole,
} from "../partners";

import {
  zusdcAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
  zalVaultAbi,
  canvasAccountAbi,
} from "@/contracts/abis";
import {
  zusdcBytecode,
  relationshipRegistryBytecode,
  zalFactoryBytecode,
  zalFundingPoolBytecode,
  zalInvoiceBytecode,
  zalVaultBytecode,
} from "@/contracts/bytecode";

export async function write<
  const TAbi extends Abi,
  TName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  chain: SandboxChain,
  from: Address,
  to: Address,
  abi: TAbi,
  functionName: TName,
  args: ContractFunctionArgs<TAbi, "nonpayable" | "payable", TName>,
): Promise<void> {
  const data = encodeFunctionData({ abi, functionName, args } as never) as Hex;

  await chain.send({ from, to, data });
}

export async function read<
  const TAbi extends Abi,
  TName extends ContractFunctionName<TAbi, "view" | "pure">,
>(
  chain: SandboxChain,
  to: Address,
  abi: TAbi,
  functionName: TName,
  args: ContractFunctionArgs<TAbi, "view" | "pure", TName>,
): Promise<unknown> {
  const data = encodeFunctionData({ abi, functionName, args } as never);
  const result = (await chain.request("eth_call", [
    { to, data },
    "latest",
  ])) as Hex;

  return decodeFunctionResult({ abi, functionName, data: result } as never);
}

async function deploy(chain: SandboxChain, data: Hex): Promise<void> {
  await chain.send({ from: SANDBOX_OWNER, data });
}

/** Six creations, then `wire` and `setAllowedVault`, exactly as Deploy.s.sol broadcasts them. */
export async function deployProtocol(chain: SandboxChain): Promise<void> {
  await deploy(
    chain,
    encodeDeployData({ abi: zusdcAbi, bytecode: zusdcBytecode }),
  );
  await deploy(
    chain,
    encodeDeployData({
      abi: zalFactoryAbi,
      bytecode: zalFactoryBytecode,
      args: [SANDBOX_OWNER],
    }),
  );
  await deploy(
    chain,
    encodeDeployData({
      abi: relationshipRegistryAbi,
      bytecode: relationshipRegistryBytecode,
      args: [d.factory],
    }),
  );
  await deploy(
    chain,
    encodeDeployData({
      abi: zalInvoiceAbi,
      bytecode: zalInvoiceBytecode,
      args: [d.factory, d.usdc],
    }),
  );
  await deploy(
    chain,
    encodeDeployData({
      abi: zalFundingPoolAbi,
      bytecode: zalFundingPoolBytecode,
      args: [
        d.usdc,
        d.invoices,
        SANDBOX_OWNER,
        d.advanceRateBps,
        d.annualFeeBps,
      ],
    }),
  );
  await deploy(
    chain,
    encodeDeployData({
      abi: zalVaultAbi,
      bytecode: zalVaultBytecode,
      args: [d.usdc, SANDBOX_OWNER, SANDBOX_KEEPER],
    }),
  );
  await write(chain, SANDBOX_OWNER, d.factory, zalFactoryAbi, "wire", [
    d.usdc,
    d.registry,
    d.invoices,
    d.pool,
  ]);
  await write(
    chain,
    SANDBOX_OWNER,
    d.factory,
    zalFactoryAbi,
    "setAllowedVault",
    [d.vault, true],
  );
}

export async function accountOf(
  chain: SandboxChain,
  admin: Address,
): Promise<Address> {
  const account = await read(
    chain,
    d.factory,
    zalFactoryAbi,
    "predictAccount",
    [admin, zeroHash],
  );

  return getAddress(account as Address);
}

export interface SeededActors {
  readonly user: Address;
  readonly userAccount: Address;
  readonly club: Address;
  readonly printShop: Address;
}

/** The canvas `admin` created, or `undefined` when it has none. */
export async function canvasOf(
  chain: SandboxChain,
  admin: Address,
): Promise<Address | undefined> {
  const account = await accountOf(chain, admin);
  const exists = await read(chain, d.factory, zalFactoryAbi, "isAccount", [
    account,
  ]);

  return exists === true ? account : undefined;
}

/**
 * A canvas that buys from the visitor: USDC, an Events budget, and a credit line with the pool. With a
 * `treasurer`, spending needs both signers, as at the demo club.
 */
async function seedBuyer(
  chain: SandboxChain,
  admin: Address,
  treasurer?: Address,
): Promise<Address> {
  await write(chain, admin, d.factory, zalFactoryAbi, "createAccount", [
    admin,
    zeroHash,
  ]);
  const account = await accountOf(chain, admin);

  if (treasurer !== undefined) {
    await write(chain, admin, account, canvasAccountAbi, "setMember", [
      treasurer,
      2,
    ]);
    await write(chain, admin, account, canvasAccountAbi, "setPolicy", [2, 0n]);
  }
  await write(chain, admin, account, canvasAccountAbi, "setBudget", [
    1n,
    SANDBOX_SEED.clubEventsBudget,
    0n,
  ]);
  await write(chain, SANDBOX_OWNER, d.usdc, zusdcAbi, "mint", [
    account,
    SANDBOX_SEED.clubAccount,
  ]);
  await write(
    chain,
    SANDBOX_OWNER,
    d.pool,
    zalFundingPoolAbi,
    "setObligorLimit",
    [account, SANDBOX_SEED.clubObligorLimit],
  );

  return account;
}

/** A canvas that sells to the visitor, with a little USDC. */
async function seedSeller(
  chain: SandboxChain,
  admin: Address,
): Promise<Address> {
  await write(chain, admin, d.factory, zalFactoryAbi, "createAccount", [
    admin,
    zeroHash,
  ]);
  const account = await accountOf(chain, admin);

  await write(chain, SANDBOX_OWNER, d.usdc, zusdcAbi, "mint", [
    account,
    SANDBOX_SEED.printShopAccount,
  ]);

  return account;
}

/** Seeds the next demo partner: a buyer like the demo club (single signer), or a seller like the print shop. */
export async function createDemoPartner(
  chain: SandboxChain,
  role: PartnerRole,
): Promise<DemoPartner> {
  const number =
    (await readDemoPartners((admin) => canvasOf(chain, admin))).length + 1;
  const admin = partnerAdmin(number, role);
  const account =
    role === "buyer"
      ? await seedBuyer(chain, admin)
      : await seedSeller(chain, admin);

  return { number, role, admin, account, name: partnerName(number) };
}

/** The whole seed. Idempotent only on a fresh chain: run it once, right after `openSandboxChain([])`. */
export async function seedSandbox(
  chain: SandboxChain,
  user: Address,
): Promise<SeededActors> {
  await deployProtocol(chain);

  await write(chain, user, d.factory, zalFactoryAbi, "createAccount", [
    user,
    zeroHash,
  ]);
  const userAccount = await accountOf(chain, user);

  await write(chain, SANDBOX_OWNER, d.usdc, zusdcAbi, "mint", [
    userAccount,
    SANDBOX_SEED.userAccount,
  ]);

  const { clubAdmin, clubTreasurer, lp } = SANDBOX_BOTS;

  const club = await seedBuyer(chain, clubAdmin, clubTreasurer);

  await write(chain, SANDBOX_OWNER, d.usdc, zusdcAbi, "mint", [
    lp,
    SANDBOX_SEED.lpDeposit,
  ]);
  await write(chain, lp, d.usdc, zusdcAbi, "approve", [
    d.pool,
    SANDBOX_SEED.lpDeposit,
  ]);
  await write(chain, lp, d.pool, zalFundingPoolAbi, "deposit", [
    SANDBOX_SEED.lpDeposit,
    lp,
  ]);

  // Policy stays 1 of 2, so nothing changes until the visitor raises it with the Approval component.
  await write(chain, user, userAccount, canvasAccountAbi, "setMember", [
    SANDBOX_BOTS.cosigner,
    2,
  ]);
  await write(chain, SANDBOX_OWNER, d.usdc, zusdcAbi, "mint", [
    user,
    SANDBOX_SEED.userWallet,
  ]);

  const { printShopAdmin } = SANDBOX_BOTS;

  const printShop = await seedSeller(chain, printShopAdmin);

  await write(
    chain,
    printShopAdmin,
    printShop,
    canvasAccountAbi,
    "proposeRelationship",
    [userAccount, 1, 0n],
  );

  return { user, userAccount, club, printShop };
}
