// Reads one canvas from the chain. Accounts, relationships and invoices are not enumerable on-chain, so the ids
// come from events (ZR-SYS-02) and the current state from views. Ghost and solid are derived from this state
// later, never stored.

import type { ZalAddresses } from "@/config/chains";

import {
  decodeFunctionData,
  getAddress,
  isAddressEqual,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type PublicClient,
} from "viem";

import {
  canvasAccountAbi,
  zusdcAbi,
  relationshipRegistryAbi,
  zalFactoryAbi,
  zalFundingPoolAbi,
  zalInvoiceAbi,
  zalVaultAbi,
} from "@/contracts/abis";
import { activityTitle, parseActivityEvent } from "@/lib/canvas/activity";
import {
  INVOICE_STATUSES,
  LEG_KINDS,
  MEMBER_ROLES,
  REL_STATUSES,
  type AccountState,
  type ActivityItem,
  type CashMove,
  type Budget,
  type CanvasState,
  type GatedCall,
  type Invoice,
  type LpPosition,
  type Member,
  type PendingOp,
  type PoolState,
  type Relationship,
  type RoutedPayment,
  type Schedule,
} from "@/lib/canvas/types";

const FROM = 0n;

/** The canvas of `wallet` is the account it predicts with salt 0. */
export async function accountOfWallet(
  client: PublicClient,
  addresses: ZalAddresses,
  wallet: Address,
): Promise<{ readonly account: Address; readonly exists: boolean }> {
  const account = await client.readContract({
    address: addresses.factory,
    abi: zalFactoryAbi,
    functionName: "predictAccount",
    args: [wallet, zeroHash],
  });
  const exists = await client.readContract({
    address: addresses.factory,
    abi: zalFactoryAbi,
    functionName: "isAccount",
    args: [account],
  });

  return { account, exists };
}

function decodeGated(data: `0x${string}`): GatedCall {
  const call = decodeFunctionData({ abi: canvasAccountAbi, data });

  switch (call.functionName) {
    case "approveInvoice":
      return {
        fn: "approveInvoice",
        invoiceId: call.args[0],
        budgetId: call.args[1],
      };
    case "escrowInvoice":
      return { fn: "escrowInvoice", invoiceId: call.args[0] };
    case "payInvoice":
      return { fn: "payInvoice", invoiceId: call.args[0] };
    case "withdraw":
      return { fn: "withdraw", to: call.args[0], amount: call.args[1] };
    case "createSchedule": {
      const [kind, recipient, invoiceId, amount, start, interval, runs] =
        call.args;
      const terms = {
        amount,
        start: Number(start),
        interval,
        runs,
      };

      // The contract ignores the recipient of a PayInvoice and the invoice of a Transfer.
      return kind === 0
        ? { fn: "createSchedule", kind: "transfer", recipient, ...terms }
        : { fn: "createSchedule", kind: "payInvoice", invoiceId, ...terms };
    }
    default:
      throw new Error(`Unexpected gated call ${call.functionName}`);
  }
}

/**
 * One op as the account stores it (`getOp`), its calldata decoded against the CanvasAccount ABI. `undefined` when
 * the account has no such op. `policyNonce` is the account's current one, read with the op when not given.
 */
export async function readOp(
  client: PublicClient,
  account: Address,
  opId: bigint,
  wallet: Address,
  policyNonce?: bigint,
): Promise<PendingOp | undefined> {
  const [op, confirmedByMe, nonce] = await Promise.all([
    client.readContract({
      address: account,
      abi: canvasAccountAbi,
      functionName: "getOp",
      args: [opId],
    }),
    client.readContract({
      address: account,
      abi: canvasAccountAbi,
      functionName: "hasConfirmed",
      args: [opId, wallet],
    }),
    policyNonce ??
      client.readContract({
        address: account,
        abi: canvasAccountAbi,
        functionName: "policyNonce",
      }),
  ]);

  if (op.data === "0x") return undefined;
  const required = await client.readContract({
    address: account,
    abi: canvasAccountAbi,
    functionName: "requiredConfirmations",
    args: [op.amount],
  });

  return {
    opId,
    call: decodeGated(op.data),
    amount: op.amount,
    confirmations: op.confirmations,
    required: Number(required),
    executed: op.executed,
    stale: op.policyNonce !== nonce,
    confirmedByMe,
  };
}

async function readAccount(
  client: PublicClient,
  addresses: ZalAddresses,
  account: Address,
  exists: boolean,
  wallet: Address,
): Promise<AccountState> {
  const balance = await client.readContract({
    address: addresses.usdc,
    abi: zusdcAbi,
    functionName: "balanceOf",
    args: [account],
  });

  if (!exists) {
    return {
      address: account,
      exists,
      balance,
      members: [],
      myRole: "none",
      threshold: 0,
      approvalLimit: 0n,
      endpointPublic: false,
      route: [],
      budgets: [],
      budgetOfInvoice: {},
      ops: [],
      schedules: [],
      vaultShares: 0n,
      vaultAssets: 0n,
    };
  }
  const read = <
    TName extends
      | "threshold"
      | "approvalLimit"
      | "policyNonce"
      | "endpointPublic"
      | "getRoute",
  >(
    functionName: TName,
  ) =>
    client.readContract({
      address: account,
      abi: canvasAccountAbi,
      functionName,
    } as never);

  const [
    threshold,
    approvalLimit,
    policyNonce,
    endpointPublic,
    route,
    logs,
    vaultShares,
    schedules,
  ] = await Promise.all([
    read("threshold") as Promise<number>,
    read("approvalLimit") as Promise<bigint>,
    read("policyNonce") as Promise<bigint>,
    read("endpointPublic") as Promise<boolean>,
    read("getRoute") as Promise<
      readonly { kind: number; target: Address; bps: number }[]
    >,
    client.getContractEvents({
      address: account,
      abi: canvasAccountAbi,
      fromBlock: FROM,
    }),
    client.readContract({
      address: addresses.vault,
      abi: zalVaultAbi,
      functionName: "balanceOf",
      args: [account],
    }),
    readSchedules(client, account),
  ]);

  const roles = new Map<string, Member>();
  const budgetIds = new Set<bigint>();
  const opIds: bigint[] = [];
  const budgetOfInvoice: Record<string, bigint> = {};

  for (const log of logs) {
    if (log.eventName === "MemberSet") {
      const address = getAddress(log.args.member as Address);

      roles.set(address, {
        address,
        role: MEMBER_ROLES[log.args.role as number] ?? "none",
      });
    } else if (log.eventName === "BudgetSet") {
      budgetIds.add(log.args.budgetId as bigint);
    } else if (log.eventName === "BudgetCharged") {
      budgetOfInvoice[String(log.args.invoiceId)] = log.args.budgetId as bigint;
    } else if (log.eventName === "OpSubmitted") {
      opIds.push(log.args.opId as bigint);
    }
  }
  const members = [...roles.values()].filter((m) => m.role !== "none");

  const budgets: Budget[] = await Promise.all(
    [...budgetIds].map(async (id) => {
      const [limit, used, periodStart, periodLength] =
        await client.readContract({
          address: account,
          abi: canvasAccountAbi,
          functionName: "budgets",
          args: [id],
        });

      return {
        id,
        limit,
        used,
        periodStart: Number(periodStart),
        periodLength: Number(periodLength),
      };
    }),
  );

  const ops: PendingOp[] = (
    await Promise.all(
      opIds.map((opId) => readOp(client, account, opId, wallet, policyNonce)),
    )
  ).flatMap((op) => (op === undefined ? [] : [op]));

  const vaultAssets =
    vaultShares === 0n
      ? 0n
      : await client.readContract({
          address: addresses.vault,
          abi: zalVaultAbi,
          functionName: "convertToAssets",
          args: [vaultShares],
        });

  return {
    address: account,
    exists,
    balance,
    members,
    myRole: roles.get(getAddress(wallet))?.role ?? "none",
    threshold,
    approvalLimit,
    endpointPublic,
    route: route.map((leg) => ({
      kind: LEG_KINDS[leg.kind] ?? "hold",
      target: leg.target,
      bps: leg.bps,
    })),
    budgets: budgets.sort((a, b) => Number(a.id - b.id)),
    budgetOfInvoice,
    ops,
    schedules,
    vaultShares,
    vaultAssets,
  };
}

const SCHEDULE_KINDS = ["transfer", "payInvoice"] as const;

/** Schedule ids run 1..scheduleCount and are never deleted, so the count enumerates them. */
async function readSchedules(
  client: PublicClient,
  account: Address,
): Promise<Schedule[]> {
  const count = await client.readContract({
    address: account,
    abi: canvasAccountAbi,
    functionName: "scheduleCount",
  });
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));

  return Promise.all(
    ids.map(async (id): Promise<Schedule> => {
      const s = await client.readContract({
        address: account,
        abi: canvasAccountAbi,
        functionName: "getSchedule",
        args: [id],
      });
      const kind = SCHEDULE_KINDS[s.kind] ?? "transfer";
      const base = {
        id,
        kind,
        amount: s.amount,
        nextAt: Number(s.nextAt),
        interval: s.interval,
        remaining: s.remaining,
        active: s.active,
      };

      return kind === "transfer"
        ? { ...base, recipient: s.recipient }
        : { ...base, invoiceId: s.invoiceId };
    }),
  );
}

async function readPool(
  client: PublicClient,
  addresses: ZalAddresses,
): Promise<PoolState> {
  const read = (
    functionName:
      "idleCash" | "totalAssets" | "advanceRateBps" | "annualFeeBps",
  ) =>
    client.readContract({
      address: addresses.pool,
      abi: zalFundingPoolAbi,
      functionName,
    });
  const [idleCash, totalAssets, advanceRateBps, annualFeeBps] =
    await Promise.all([
      read("idleCash"),
      read("totalAssets"),
      read("advanceRateBps"),
      read("annualFeeBps"),
    ]);

  return {
    address: addresses.pool,
    idleCash: idleCash as bigint,
    totalAssets: totalAssets as bigint,
    advanceRateBps: Number(advanceRateBps),
    annualFeeBps: Number(annualFeeBps),
  };
}

async function readLp(
  client: PublicClient,
  addresses: ZalAddresses,
  wallet: Address,
): Promise<LpPosition> {
  const [shares, maxWithdraw, walletUsdc, allowance] = await Promise.all([
    client.readContract({
      address: addresses.pool,
      abi: zalFundingPoolAbi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    client.readContract({
      address: addresses.pool,
      abi: zalFundingPoolAbi,
      functionName: "maxWithdraw",
      args: [wallet],
    }),
    client.readContract({
      address: addresses.usdc,
      abi: zusdcAbi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    client.readContract({
      address: addresses.usdc,
      abi: zusdcAbi,
      functionName: "allowance",
      args: [wallet, addresses.pool],
    }),
  ]);
  const assets =
    shares === 0n
      ? 0n
      : await client.readContract({
          address: addresses.pool,
          abi: zalFundingPoolAbi,
          functionName: "convertToAssets",
          args: [shares],
        });

  return { shares, assets, maxWithdraw, walletUsdc, allowance };
}

export async function readInvoice(
  client: PublicClient,
  addresses: ZalAddresses,
  id: bigint,
): Promise<Invoice> {
  const inv = await client.readContract({
    address: addresses.invoices,
    abi: zalInvoiceAbi,
    functionName: "getInvoice",
    args: [id],
  });
  const owner = await client
    .readContract({
      address: addresses.invoices,
      abi: zalInvoiceAbi,
      functionName: "ownerOf",
      args: [id],
    })
    .catch(() => undefined);
  const funded = owner !== undefined && isAddressEqual(owner, addresses.pool);
  const [limit, outstanding] = await Promise.all([
    client.readContract({
      address: addresses.pool,
      abi: zalFundingPoolAbi,
      functionName: "obligorLimit",
      args: [inv.buyer],
    }),
    client.readContract({
      address: addresses.pool,
      abi: zalFundingPoolAbi,
      functionName: "obligorOutstanding",
      args: [inv.buyer],
    }),
  ]);
  const advance = funded
    ? await client.readContract({
        address: addresses.pool,
        abi: zalFundingPoolAbi,
        functionName: "advanceOf",
        args: [id],
      })
    : undefined;

  return {
    id,
    relationshipId: inv.relationshipId,
    seller: inv.seller,
    buyer: inv.buyer,
    faceValue: inv.faceValue,
    escrowed: inv.escrowed,
    issuedAt: Number(inv.issuedAt),
    dueDate: Number(inv.dueDate),
    approvedAt: Number(inv.approvedAt),
    status: INVOICE_STATUSES[inv.status] ?? "none",
    docHash: inv.docHash,
    owner,
    advance:
      advance === undefined || advance.seller === zeroAddress
        ? undefined
        : {
            principal: advance.principal,
            fee: advance.fee,
            fundedAt: Number(advance.fundedAt),
          },
    buyerCredit: { limit, outstanding },
  };
}

interface LoggedEvent {
  readonly eventName: string;
  readonly args: unknown;
  readonly blockNumber: bigint;
  readonly transactionHash: Hash;
  readonly logIndex: number;
}

export interface ReadCanvasParams {
  readonly client: PublicClient;
  readonly addresses: ZalAddresses;
  readonly wallet: Address;
  /** The canvas to read, already verified for `wallet`; the wallet's own canvas when missing. */
  readonly account?: { readonly account: Address; readonly exists: boolean };
  /** Display names for accounts the app knows, keyed by checksummed address. */
  readonly labels?: Readonly<Record<string, string>>;
}

export async function readCanvasState({
  client,
  addresses,
  wallet,
  account: target,
  labels = {},
}: ReadCanvasParams): Promise<CanvasState> {
  const { account, exists } =
    target ?? (await accountOfWallet(client, addresses, wallet));
  const [accountState, pool, lp, asBuyer, asSeller, block, cashIn, cashOut] =
    await Promise.all([
      readAccount(client, addresses, account, exists, wallet),
      readPool(client, addresses),
      readLp(client, addresses, wallet),
      client.getContractEvents({
        address: addresses.registry,
        abi: relationshipRegistryAbi,
        fromBlock: FROM,
        args: { buyer: account },
      }),
      client.getContractEvents({
        address: addresses.registry,
        abi: relationshipRegistryAbi,
        fromBlock: FROM,
        args: { seller: account },
      }),
      client.getBlock(),
      client.getContractEvents({
        address: addresses.usdc,
        abi: zusdcAbi,
        eventName: "Transfer",
        fromBlock: FROM,
        args: { to: account },
      }),
      client.getContractEvents({
        address: addresses.usdc,
        abi: zusdcAbi,
        eventName: "Transfer",
        fromBlock: FROM,
        args: { from: account },
      }),
    ]);

  const relLogs = [...asBuyer, ...asSeller];
  const relIds = [
    ...new Set(relLogs.map((log) => (log.args as { id: bigint }).id)),
  ];
  const relationships: Relationship[] = await Promise.all(
    relIds.map(async (id) => {
      const rel = await client.readContract({
        address: addresses.registry,
        abi: relationshipRegistryAbi,
        functionName: "getRelationship",
        args: [id],
      });

      return {
        id,
        buyer: rel.buyer,
        seller: rel.seller,
        proposer: rel.proposer,
        proposedAt: Number(rel.proposedAt),
        expiresAt: Number(rel.expiresAt),
        status: REL_STATUSES[rel.status] ?? "none",
      };
    }),
  );

  const invoiceLogs =
    relIds.length === 0
      ? []
      : await client.getContractEvents({
          address: addresses.invoices,
          abi: zalInvoiceAbi,
          fromBlock: FROM,
          args: { relationshipId: relIds },
        } as never);
  const invoiceIds = [
    ...new Set(
      (invoiceLogs as LoggedEvent[]).flatMap((log) =>
        log.eventName === "InvoiceIssued"
          ? [(log.args as { id: bigint }).id]
          : [],
      ),
    ),
  ];
  const invoices = await Promise.all(
    invoiceIds.map((id) => readInvoice(client, addresses, id)),
  );

  const mine = new Set(invoiceIds.map(String));
  const [allInvoiceLogs, poolLogs, accountLogs] = await Promise.all([
    invoiceIds.length === 0
      ? Promise.resolve([])
      : client.getContractEvents({
          address: addresses.invoices,
          abi: zalInvoiceAbi,
          fromBlock: FROM,
        }),
    invoiceIds.length === 0
      ? Promise.resolve([])
      : client.getContractEvents({
          address: addresses.pool,
          abi: zalFundingPoolAbi,
          fromBlock: FROM,
        }),
    exists
      ? client.getContractEvents({
          address: account,
          abi: canvasAccountAbi,
          fromBlock: FROM,
        })
      : Promise.resolve([]),
  ]);
  const relevant = [
    ...relLogs,
    ...(allInvoiceLogs as LoggedEvent[]).filter((log) => {
      const id = (log.args as { id?: bigint }).id;

      return (
        id !== undefined && mine.has(String(id)) && log.eventName !== "Transfer"
      );
    }),
    ...(poolLogs as LoggedEvent[]).filter((log) => {
      const id = (log.args as { invoiceId?: bigint }).invoiceId;

      return id !== undefined && mine.has(String(id));
    }),
    ...(accountLogs as LoggedEvent[]),
  ] as LoggedEvent[];

  const cashLogs = [...cashIn, ...cashOut];
  const blockNumbers = [
    ...new Set([...relevant, ...cashLogs].map((log) => log.blockNumber)),
  ];
  const timestamps = new Map(
    await Promise.all(
      blockNumbers.map(
        async (blockNumber) =>
          [
            blockNumber,
            Number((await client.getBlock({ blockNumber })).timestamp),
          ] as const,
      ),
    ),
  );
  const activity: ActivityItem[] = relevant
    .flatMap((log) => {
      const event = parseActivityEvent(
        log.eventName,
        (log.args ?? {}) as Record<string, unknown>,
      );

      return event === undefined
        ? []
        : [
            {
              key: `${log.transactionHash}:${log.logIndex}`,
              timestamp: timestamps.get(log.blockNumber) ?? 0,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
              title: activityTitle(event),
              event,
            },
          ];
    })
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? 0
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    );

  const byChainOrder = (
    a: { blockNumber: bigint; logIndex: number },
    b: { blockNumber: bigint; logIndex: number },
  ) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1;
  const cash: CashMove[] = cashLogs
    // A transfer to itself moves nothing, and would otherwise count once in and once out.
    .filter(
      ({ args }) =>
        !(
          isAddressEqual(args.from ?? zeroAddress, account) &&
          isAddressEqual(args.to ?? zeroAddress, account)
        ),
    )
    .sort(byChainOrder)
    .map((log) => {
      const incoming = isAddressEqual(log.args.to ?? zeroAddress, account);
      const value = log.args.value ?? 0n;

      return {
        key: `${log.transactionHash}:${log.logIndex}`,
        timestamp: timestamps.get(log.blockNumber) ?? 0,
        blockNumber: log.blockNumber,
        amount: incoming ? value : -value,
        counterparty: (incoming ? log.args.from : log.args.to) ?? zeroAddress,
      };
    });
  const routed: RoutedPayment[] = (accountLogs as LoggedEvent[])
    .filter((log) => log.eventName === "PaymentRouted")
    .sort(byChainOrder)
    .map((log) => {
      const args = log.args as {
        invoiceId?: bigint;
        amount?: bigint;
        legAmounts?: readonly bigint[];
      };

      return {
        key: `${log.transactionHash}:${log.logIndex}`,
        timestamp: timestamps.get(log.blockNumber) ?? 0,
        invoiceId: args.invoiceId ?? 0n,
        amount: args.amount ?? 0n,
        legAmounts: args.legAmounts ?? [],
      };
    });

  return {
    wallet,
    account: accountState,
    relationships: relationships.sort((a, b) => Number(a.id - b.id)),
    invoices: invoices.sort((a, b) => Number(a.id - b.id)),
    pool,
    lp,
    activity,
    cash,
    routed,
    labels,
    now: Number(block.timestamp),
  };
}
