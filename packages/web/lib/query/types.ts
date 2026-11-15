import type {
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import type { AppError } from "@/lib/query/errors";

/** `payload` is required unless the hook takes none (`TPayload` is `void`). */
type PayloadProp<TPayload> = [TPayload] extends [void]
  ? { readonly payload?: undefined }
  : { readonly payload: TPayload };

/**
 * Props of every query hook. `payload` carries the inputs of the read. `options` is TanStack's own option bag
 * minus the two fields the hook owns, so callers can set `enabled`, `staleTime`, `select` and so on.
 */
export type QueryProps<
  TPayload,
  TData,
  TError = AppError,
> = PayloadProp<TPayload> & {
  readonly options?: Omit<
    UseQueryOptions<TData, TError>,
    "queryKey" | "queryFn"
  >;
};

export type QueryResult<TData, TError = AppError> = UseQueryResult<
  TData,
  TError
>;

/**
 * Props of every mutation hook. The payload is the argument of `mutate(payload)`, as in TanStack Query, so it is
 * not a prop. `options` is TanStack's option bag minus `mutationFn`.
 */
export interface MutationProps<TData, TPayload, TError = AppError> {
  readonly options?: Omit<
    UseMutationOptions<TData, TError, TPayload>,
    "mutationFn"
  >;
}

export type MutationResult<
  TData,
  TPayload,
  TError = AppError,
> = UseMutationResult<TData, TError, TPayload>;
