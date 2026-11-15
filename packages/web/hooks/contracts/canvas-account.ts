"use client";

// CanvasAccount: the reads of one account and every action a canvas takes. Admin actions are direct calls.
// Spending actions (approve, escrow, pay an invoice, withdraw) are gated: `useSubmitOp` submits one, other
// approvers `useConfirmOp` it, and it executes inside the confirmation that reaches the threshold (ZR-ACC-03/04).

import type { ZalNetwork } from "@/config/chains";
import type { GatedCall } from "@/lib/canvas/types";
import type { SpendWindow } from "@/lib/canvas/spend-window";
import type {
  MutationProps,
  MutationResult,
  QueryProps,
  QueryResult,
} from "@/lib/query/types";

import { useQuery } from "@tanstack/react-query";
import {
  encodeFunctionData,
  type Address,
  type ContractFunctionArgs,
  type Hex,
  type PublicClient,
  zeroAddress,
} from "viem";
import { useConfig, type Config } from "wagmi";
import { getPublicClient } from "wagmi/actions";

import { canvasAccountAbi } from "@/contracts/abis";
import { useSelectedAccount } from "@/hooks/use-selected-account";
import {
  allows,
  ROLE_FOR_CALL,
  roleReason,
  type AccountCall,
} from "@/lib/canvas/roles";
import { signerIdentity } from "@/lib/contracts/identity";
import {
  simulateAndWrite,
  useContractMutation,
  type WriteResult,
} from "@/lib/contracts/write";
import { ContractError, toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

type AccountAbi = typeof canvasAccountAbi;
type DirectAction = AccountCall;

type ArgsOf<TName extends DirectAction> = ContractFunctionArgs<
  AccountAbi,
  "nonpayable",
  TName
>;

/**
 * The arguments only: the call goes to the selected canvas as `signerIdentity` verifies it on the chain at send
 * time (the wallet's own when none is selected), never to an address the caller passes.
 */
export interface AccountCallPayload<TName extends DirectAction> {
  readonly args: ArgsOf<TName>;
}

/** The verified canvas the wallet acts on, refused before the wallet prompt when its role is below the call's. */
async function targetFor(
  config: Config,
  network: ZalNetwork,
  selected: Address | undefined,
  call: AccountCall,
): Promise<Address> {
  const identity = await signerIdentity(config, network, selected);
  const needed = ROLE_FOR_CALL[call];

  if (!allows(identity.role, needed))
    throw new ContractError(roleReason(needed), undefined);

  return identity.account;
}

function useAccountCall<TName extends DirectAction>(
  functionName: TName,
  network: ZalNetwork | undefined,
  options: MutationProps<WriteResult, AccountCallPayload<TName>>["options"],
): MutationResult<WriteResult, AccountCallPayload<TName>> {
  const selected = useSelectedAccount();

  return useContractMutation<AccountCallPayload<TName>>({
    network,
    options,
    send: async ({ args }, config, net) =>
      simulateAndWrite(config, net, {
        address: await targetFor(config, net, selected, functionName),
        abi: canvasAccountAbi,
        functionName,
        args: args as readonly unknown[],
      }),
  });
}

interface NetworkProps<TPayload> extends MutationProps<WriteResult, TPayload> {
  readonly network: ZalNetwork | undefined;
}

type CallProps<TName extends DirectAction> = NetworkProps<
  AccountCallPayload<TName>
>;

export const useProposeRelationship = ({
  network,
  options,
}: CallProps<"proposeRelationship">) =>
  useAccountCall("proposeRelationship", network, options);
export const useAcceptRelationship = ({
  network,
  options,
}: CallProps<"acceptRelationship">) =>
  useAccountCall("acceptRelationship", network, options);
export const useRejectRelationship = ({
  network,
  options,
}: CallProps<"rejectRelationship">) =>
  useAccountCall("rejectRelationship", network, options);
export const useCancelRelationship = ({
  network,
  options,
}: CallProps<"cancelRelationship">) =>
  useAccountCall("cancelRelationship", network, options);
/** Redeems a signed invite link: the relationship is created already Active, in one transaction (ZR-REL-03). */
export const useAcceptInvite = ({
  network,
  options,
}: CallProps<"acceptInvite">) =>
  useAccountCall("acceptInvite", network, options);
export const useIssueInvoice = ({
  network,
  options,
}: CallProps<"issueInvoice">) =>
  useAccountCall("issueInvoice", network, options);
export const useCancelInvoice = ({
  network,
  options,
}: CallProps<"cancelInvoice">) =>
  useAccountCall("cancelInvoice", network, options);
export const useRejectInvoice = ({
  network,
  options,
}: CallProps<"rejectInvoice">) =>
  useAccountCall("rejectInvoice", network, options);
export const useRequestAdvance = ({
  network,
  options,
}: CallProps<"requestAdvance">) =>
  useAccountCall("requestAdvance", network, options);
export const useSetRoute = ({ network, options }: CallProps<"setRoute">) =>
  useAccountCall("setRoute", network, options);
export const useSetBudget = ({ network, options }: CallProps<"setBudget">) =>
  useAccountCall("setBudget", network, options);
export const useSetEndpointPublic = ({
  network,
  options,
}: CallProps<"setEndpointPublic">) =>
  useAccountCall("setEndpointPublic", network, options);
export const useSetMember = ({ network, options }: CallProps<"setMember">) =>
  useAccountCall("setMember", network, options);
export const useSetPolicy = ({ network, options }: CallProps<"setPolicy">) =>
  useAccountCall("setPolicy", network, options);
export const useVaultDeposit = ({
  network,
  options,
}: CallProps<"vaultDeposit">) =>
  useAccountCall("vaultDeposit", network, options);
export const useVaultRedeem = ({
  network,
  options,
}: CallProps<"vaultRedeem">) => useAccountCall("vaultRedeem", network, options);

/** ABI-encodes a gated call to the account itself, the `data` that `submit` takes. */
export function encodeGatedCall(call: GatedCall): Hex {
  switch (call.fn) {
    case "approveInvoice":
      return encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: call.fn,
        args: [call.invoiceId, call.budgetId],
      });
    case "escrowInvoice":
    case "payInvoice":
      return encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: call.fn,
        args: [call.invoiceId],
      });
    case "withdraw":
      return encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: call.fn,
        args: [call.to, call.amount],
      });
    case "createSchedule":
      return encodeFunctionData({
        abi: canvasAccountAbi,
        functionName: call.fn,
        args: [
          call.kind === "transfer" ? 0 : 1,
          call.recipient ?? zeroAddress,
          call.invoiceId ?? 0n,
          call.amount,
          BigInt(call.start),
          call.interval,
          call.runs,
        ],
      });
  }
}

export interface SubmitOpPayload {
  readonly call: GatedCall;
}

/** Submits a gated operation. The submitter's confirmation counts, so under the threshold it executes at once. */
export function useSubmitOp({
  network,
  options,
}: NetworkProps<SubmitOpPayload>) {
  const selected = useSelectedAccount();

  return useContractMutation<SubmitOpPayload>({
    network,
    options,
    send: async ({ call }, config, net) =>
      simulateAndWrite(config, net, {
        address: await targetFor(config, net, selected, "submit"),
        abi: canvasAccountAbi,
        functionName: "submit",
        args: [encodeGatedCall(call)],
      }),
  });
}

/** One Approver or Admin stops a schedule (ZR-SCH-04). */
export const useCancelSchedule = ({
  network,
  options,
}: CallProps<"cancelSchedule">) =>
  useAccountCall("cancelSchedule", network, options);
/** Runs a due schedule; any wallet may (ZR-SCH-05), and the run pays only what the schedule stores. */
export const useRunSchedule = ({
  network,
  options,
}: CallProps<"runSchedule">) => useAccountCall("runSchedule", network, options);

export const useConfirmOp = ({ network, options }: CallProps<"confirm">) =>
  useAccountCall("confirm", network, options);
export const useRevokeOp = ({ network, options }: CallProps<"revoke">) =>
  useAccountCall("revoke", network, options);

export interface AccountPolicy {
  readonly threshold: number;
  readonly approvalLimit: bigint;
  readonly policyNonce: bigint;
  readonly opCount: bigint;
}

/** The approval policy of one account. */
export function useAccountPolicy({
  payload,
  options,
}: QueryProps<
  { readonly network: ZalNetwork; readonly account: Address },
  AccountPolicy
>): QueryResult<AccountPolicy> {
  const config = useConfig();
  const { network, account } = payload;

  return useQuery<AccountPolicy, AppError>({
    ...options,
    queryKey: [...queryKeys.account(network.chain.id, account), "policy"],
    queryFn: async () => {
      try {
        const client = getPublicClient(config, {
          chainId: network.chain.id as never,
        }) as PublicClient;
        const read = <T>(
          functionName:
            "threshold" | "approvalLimit" | "policyNonce" | "opCount",
        ) =>
          client.readContract({
            address: account,
            abi: canvasAccountAbi,
            functionName,
          }) as Promise<T>;
        const [threshold, approvalLimit, policyNonce, opCount] =
          await Promise.all([
            read<number>("threshold"),
            read<bigint>("approvalLimit"),
            read<bigint>("policyNonce"),
            read<bigint>("opCount"),
          ]);

        return { threshold, approvalLimit, policyNonce, opCount };
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}

/**
 * `spendWindow()` of one account, read from the chain whatever the canvas source (ADR 0012: the API is a read model,
 * and this decides how many signatures an op needs). Shares the account's key, so its events refresh it.
 */
export function useSpendWindow({
  payload,
  options,
}: QueryProps<
  { readonly network: ZalNetwork | undefined; readonly account: Address },
  SpendWindow
>): QueryResult<SpendWindow> {
  const config = useConfig();
  const { network, account } = payload;
  const chainId = network?.chain.id ?? 0;

  return useQuery<SpendWindow, AppError>({
    ...options,
    enabled: network !== undefined && (options?.enabled ?? true),
    queryKey: [...queryKeys.account(chainId, account), "spendWindow"],
    queryFn: async () => {
      try {
        const client = getPublicClient(config, {
          chainId: chainId as never,
        }) as PublicClient;
        const [start, spent, remaining] = await client.readContract({
          address: account,
          abi: canvasAccountAbi,
          functionName: "spendWindow",
        });

        return { start: Number(start), spent, remaining };
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
}
