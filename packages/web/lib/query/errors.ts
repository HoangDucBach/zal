import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  TimeoutError,
  UserRejectedRequestError,
  decodeErrorResult,
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

/** A contract call reverted, or the chain rejected the transaction. */
export class ContractError extends Error {
  readonly kind = "contract" as const;

  constructor(
    message: string,
    /** Custom error name from the ABI when the revert carried one. */
    readonly errorName: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ContractError";
  }
}

/** The user closed or rejected a wallet prompt. Not a failure to report. */
export class WalletRejectedError extends Error {
  readonly kind = "wallet-rejected" as const;

  constructor(options?: ErrorOptions) {
    super("The request was rejected in the wallet.", options);
    this.name = "WalletRejectedError";
  }
}

export class UnknownError extends Error {
  readonly kind = "unknown" as const;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnknownError";
  }
}

/**
 * The /v1 API answered with an RFC 9457 problem, or did not answer. `code` is the API's machine-readable code;
 * `unreachable` (status 0) means the request never got an answer.
 */
export class ApiError extends Error {
  readonly kind = "api" as const;

  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ApiError";
  }
}

export type AppError =
  ContractError | WalletRejectedError | ApiError | UnknownError;

function isAppError(error: unknown): error is AppError {
  return (
    error instanceof ContractError ||
    error instanceof WalletRejectedError ||
    error instanceof ApiError ||
    error instanceof UnknownError
  );
}

/** Every custom error a Zal contract can revert with, from any of them, with its library errors. */
const zalErrorAbi = [
  ...canvasAccountAbi,
  ...relationshipRegistryAbi,
  ...zalInvoiceAbi,
  ...zalFundingPoolAbi,
  ...zalFactoryAbi,
  ...zalVaultAbi,
  ...zusdcAbi,
].filter((item) => item.type === "error");

type ZalErrorName = Extract<
  (
    | typeof canvasAccountAbi
    | typeof relationshipRegistryAbi
    | typeof zalInvoiceAbi
    | typeof zalFundingPoolAbi
    | typeof zalFactoryAbi
    | typeof zalVaultAbi
    | typeof zusdcAbi
  )[number],
  { type: "error" }
>["name"];

/** A plain-language reason for every one, so no revert reaches the user as a selector. */
const REASONS: Readonly<Record<ZalErrorName, string>> = {
  // CanvasAccount
  NotFactory: "Only the Zal factory can set up a canvas",
  AlreadyInitialized: "This canvas is already set up",
  ZeroAddress: "An address is missing",
  NotAdmin: "Only an Admin of this account can do that",
  NotApprover: "Only an Approver or Admin of this account can do that",
  NotSelf: "Runs only through the approval policy · submit as an operation",
  NotSettlement: "Only Zal settlement can pay into a canvas",
  LastAdmin: "A canvas needs at least one Admin",
  InvalidThreshold: "Threshold must be 1 to the number of approvers",
  OpNotAllowed: "That call cannot be submitted as an operation",
  OpNotFound: "That operation does not exist",
  OpAlreadyExecuted: "That operation has already run",
  OpStale: "Members or policy changed · submit again",
  AlreadyConfirmed: "You already confirmed this operation",
  NotConfirmed: "Not confirmed by you · nothing to revoke",
  InvalidBudget: "The budget needs a limit above zero",
  BudgetNotFound: "That budget does not exist on this account",
  BudgetExceeded: "No budget room this period",
  InvalidRoute: "Split: 100% total · ≤ 8 legs · transfer needs a recipient",
  VaultNotAllowed: "That vault is not on the Zal allow list",
  // RelationshipRegistry
  NotAccount: "Not a Zal canvas",
  SelfRelationship: "An account cannot have a relationship with itself",
  ExpiryInPast: "The proposal expiry must be in the future",
  RelationshipExists: "Already proposed or active in this direction",
  NotProposed: "That relationship is not waiting for an answer",
  ProposalExpired: "The proposal has expired",
  NotCounterparty: "Only the other party can answer this proposal",
  NotProposer: "Only the account that proposed can cancel the proposal",
  InviteExpired: "The invite has expired",
  InviteNonceUsed: "The invite has already been used",
  InviteSignerNotAdmin: "The invite was not signed by an Admin of its canvas",
  ECDSAInvalidSignature: "The invite signature is not valid",
  ECDSAInvalidSignatureLength: "The invite signature is not valid",
  ECDSAInvalidSignatureS: "The invite signature is not valid",
  InvalidShortString: "A text value is too long",
  StringTooLong: "A text value is too long",
  // ZalInvoice
  RelationshipNotActive: "The relationship is not active yet",
  NotSeller: "Only the seller can do that",
  NotBuyer: "Only the buyer can do that",
  ZeroFaceValue: "The face value must be more than zero",
  DueDateNotInFuture: "The due date must be in the future",
  WrongStatus: "The invoice is not in a state that allows this",
  AlreadyEscrowed: "Already escrowed",
  NotPayable:
    "Only the buyer pays before due · others need an escrowed invoice",
  TransferRestricted:
    "Invoice moves only seller → funding pool, while approved",
  ERC721IncorrectOwner: "That invoice belongs to someone else",
  ERC721InsufficientApproval: "That invoice belongs to someone else",
  ERC721InvalidApprover: "That invoice cannot be approved for transfer",
  ERC721InvalidOperator: "That invoice cannot be approved for transfer",
  ERC721InvalidOwner: "That invoice owner is not valid",
  ERC721InvalidReceiver: "That invoice cannot be sent there",
  ERC721InvalidSender: "That invoice cannot be sent from there",
  ERC721NonexistentToken: "That invoice does not exist",
  // ZalFundingPool
  InvalidAdvanceRate: "The advance rate is out of range",
  AlreadyFunded: "This invoice is already funded",
  NotApproved: "Buyer has not approved yet",
  PastDue: "Past due · no advance",
  ZeroPrincipal: "The advance would be zero",
  FeeExceedsReserve: "The fee would be larger than the reserve",
  ObligorLimitExceeded: "Needs escrow or room in the buyer's credit line",
  InsufficientIdleCash: "Pool idle cash too low for this advance",
  NotInvoiceContract: "Only the Zal invoice contract can do that",
  NoAdvance: "This invoice has no advance",
  WrongRepayment: "Repayment ≠ face value",
  ERC4626ExceededMaxDeposit: "That deposit is more than the pool accepts",
  ERC4626ExceededMaxMint: "That deposit is more than the pool accepts",
  ERC4626ExceededMaxRedeem: "You do not hold that many shares",
  ERC4626ExceededMaxWithdraw:
    "More than withdrawable now · cash may be advanced out",
  // ZalFactory
  AlreadyWired: "The factory is already wired",
  NotWired: "The Zal contracts are not wired yet",
  WiringMismatch: "The Zal contracts are wired to each other wrongly",
  VaultAssetMismatch: "That vault does not hold USDC",
  FailedDeployment: "The canvas could not be created",
  InsufficientBalance: "Not enough balance to create the canvas",
  // ZalVault
  NotOwnerOrKeeper: "Only the vault owner or keeper can do that",
  ZeroAmount: "The amount must be more than zero",
  ScheduleStartTooSoon: "Start at least 1 minute from now",
  InvalidScheduleTiming: "Once, or every ≥ 1 min for 1–1000 runs",
  InvalidScheduleRecipient: "Recipient must be another address",
  InvoiceNotSchedulable: "Only an approved invoice you pay",
  ScheduleNotActive: "Schedule ended or cancelled",
  ScheduleNotDue: "Not due yet",
  // Shared library errors
  OwnableInvalidOwner: "That owner address is not valid",
  OwnableUnauthorizedAccount: "Only the contract owner can do that",
  ReentrancyGuardReentrantCall: "A payment step tried to run twice at once",
  SafeCastOverflowedUintDowncast: "A number is too large",
  SafeERC20FailedOperation: "A USDC transfer failed",
  ERC20InsufficientBalance: "Not enough USDC",
  ERC20InsufficientAllowance: "The USDC allowance is too low",
  ERC20InvalidApprover: "That USDC approver is not valid",
  ERC20InvalidReceiver: "USDC cannot be sent to that address",
  ERC20InvalidSender: "USDC cannot be sent from that address",
  ERC20InvalidSpender: "That USDC spender is not valid",
};

/**
 * The custom error a revert carried, decoded against every Zal ABI. viem decodes against the ABI of the contract
 * called, but a revert can come from deeper: proposeRelationship on a CanvasAccount reverts in the registry.
 */
function zalErrorName(
  reverted: ContractFunctionRevertedError,
): ZalErrorName | undefined {
  if (reverted.raw === undefined)
    return reverted.data?.errorName as ZalErrorName | undefined;
  try {
    return decodeErrorResult({ abi: zalErrorAbi, data: reverted.raw })
      .errorName as ZalErrorName;
  } catch {
    return undefined;
  }
}

/** Converts anything thrown by viem, wagmi or zod into an AppError. Idempotent. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) return error;
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof UserRejectedRequestError) !== null) {
      return new WalletRejectedError({ cause: error });
    }
    const reverted = error.walk(
      (e) => e instanceof ContractFunctionRevertedError,
    );

    if (reverted instanceof ContractFunctionRevertedError) {
      const name = zalErrorName(reverted);

      return new ContractError(
        name === undefined ? reverted.shortMessage : REASONS[name],
        name,
        { cause: error },
      );
    }

    return new ContractError(error.shortMessage, undefined, { cause: error });
  }
  if (error instanceof Error)
    return new UnknownError(error.message, { cause: error });

  return new UnknownError("Unknown error");
}

/** The RPC did not answer, as opposed to a call that reverted or a value the client could not decode. */
export function isRpcUnreachable(error: AppError): boolean {
  let cause: unknown = error.cause;

  while (cause instanceof Error) {
    if (cause instanceof HttpRequestError || cause instanceof TimeoutError)
      return true;
    cause = cause.cause;
  }

  return false;
}
