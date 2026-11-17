"use client";

// The canvas layout: positions, child canvases and drafts. The sandbox keeps it in browser storage.
// Live mode keeps it on the API, per account, so it follows the account to every browser and member; edits save
// after the first sign-in, and a stale save replays the edits on the newer layout (lib/api/layout-sync.ts).

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";
import type { CanvasLayout } from "@/lib/canvas/layout";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useCanvasSnapshot,
  type CanvasSnapshot,
} from "@/hooks/contracts/canvas";
import { useApiSignIn } from "@/hooks/use-api-session";
import { api, apiUrl } from "@/lib/api/client";
import {
  canSave,
  INITIAL_SYNC,
  isDirty,
  layoutSyncReducer,
  viewOf,
  type LayoutChange,
  type LayoutSync,
  type LayoutSyncEvent,
} from "@/lib/api/layout-sync";
import { apiSessions } from "@/lib/api/session";
import {
  EMPTY_LAYOUT,
  layoutStorageKey,
  parseLayout,
  parseStoredLayout,
  serializeLayout,
} from "@/lib/canvas/layout";
import { usePresentationEpoch } from "@/lib/canvas/presentation";
import { ApiError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

export interface LayoutUpdateOptions {
  /** Derived from chain state (a new node gets a position): never asks for sign-in by itself. */
  readonly derived?: boolean;
}

export type UpdateLayout = (
  change: LayoutChange,
  options?: LayoutUpdateOptions,
) => void;

/** Where the layout is kept, for the canvas to say when it is not saved. */
export type LayoutPersistence =
  | { readonly kind: "browser" }
  | { readonly kind: "saved" }
  | { readonly kind: "saving" }
  /** A user edit waits for the first sign-in. */
  | { readonly kind: "signIn"; readonly signIn: () => void }
  /** The API refused the save for good (not a member, out of its limits): no retry until the next edit. */
  | { readonly kind: "refused"; readonly reason: string }
  /** The last edit was not applied: the API would refuse the layout it makes. */
  | { readonly kind: "rejected"; readonly reason: string };

export interface CanvasLayoutTarget {
  readonly network: ZalNetwork | undefined;
  readonly wallet: Address | undefined;
  /** The account, once it exists on-chain. */
  readonly account: Address | undefined;
  /** The canvas request the snapshot was read for (`?account=`), so the layout shares that query. */
  readonly selected: Address | undefined;
}

function load(key: string | undefined): CanvasLayout {
  if (key === undefined || typeof window === "undefined") return EMPTY_LAYOUT;
  try {
    return parseStoredLayout(window.localStorage.getItem(key));
  } catch {
    return EMPTY_LAYOUT;
  }
}

function save(key: string | undefined, layout: CanvasLayout): void {
  if (key === undefined) return;
  try {
    window.localStorage.setItem(key, serializeLayout(layout));
  } catch {
    // Storage full or blocked: the layout lives for this session only.
  }
}

/**
 * The layout stored in the browser under `key` (chain and account), reloaded when the key changes or a sandbox
 * Reset clears it (the presentation epoch).
 */
function useBrowserLayout(key: string | undefined) {
  const epoch = usePresentationEpoch();
  const [stored, setStored] = useState<{
    readonly key: string | undefined;
    readonly epoch: number;
    readonly layout: CanvasLayout;
  }>(() => ({ key, epoch, layout: load(key) }));
  const current = stored.key === key && stored.epoch === epoch;

  if (!current) setStored({ key, epoch, layout: load(key) });

  const update = useCallback<UpdateLayout>(
    (change) =>
      setStored((previous) => {
        const layout = change(previous.layout);

        if (layout === previous.layout) return previous;
        save(previous.key, layout);

        return { ...previous, layout };
      }),
    [],
  );

  return [current ? stored.layout : load(key), update] as const;
}

const selectSaved = (snapshot: CanvasSnapshot) => snapshot.saved;
const SAVE_DEBOUNCE_MS = 500;
const MAX_RETRY_MS = 30_000;

/** The account's layout on the API, with unsaved edits applied over it. */
function useApiLayout(target: CanvasLayoutTarget, enabled: boolean) {
  const { network, wallet, account, selected } = target;
  const queryClient = useQueryClient();
  const scope = enabled && account !== undefined ? account : undefined;
  const saved = useCanvasSnapshot({
    payload: {
      network: scope === undefined ? undefined : network,
      wallet,
      selected,
    },
    select: selectSaved,
  });
  const { state: session, signIn } = useApiSignIn(network, wallet);
  const [held, setHeld] = useState<{
    readonly scope: Address | undefined;
    readonly sync: LayoutSync;
  }>({ scope, sync: INITIAL_SYNC });

  // Another account (or none) starts over: its edits never apply to a different layout.
  if (held.scope !== scope) setHeld({ scope, sync: INITIAL_SYNC });
  const sync = held.scope === scope ? held.sync : INITIAL_SYNC;

  const dispatch = useCallback(
    (event: LayoutSyncEvent) =>
      setHeld((previous) => ({
        ...previous,
        sync: layoutSyncReducer(previous.sync, event),
      })),
    [],
  );

  const data = saved.data;
  // Every fetch is fed to the reducer, not only one whose result differs: TanStack keeps the same `data` object for
  // an equal answer, and the refetch after a 409 may well be equal to a snapshot the reducer set aside.
  const fetchedAt = saved.dataUpdatedAt;

  useEffect(() => {
    // `undefined` is a snapshot read from the chain while the API is down: no saved layout is known.
    if (scope === undefined || data === undefined) return;
    dispatch({
      type: "server",
      layout: data === null ? EMPTY_LAYOUT : parseLayout(data.layout),
      revision: data?.revision ?? 0,
    });
  }, [scope, data, fetchedAt, dispatch]);

  const token =
    session.status === "signedIn" ? session.session.token : undefined;
  const chainId = network?.chain.id;

  useEffect(() => {
    if (
      scope === undefined ||
      chainId === undefined ||
      wallet === undefined ||
      token === undefined ||
      !canSave(sync)
    )
      return;
    const delay =
      sync.failures === 0
        ? SAVE_DEBOUNCE_MS
        : Math.min(MAX_RETRY_MS, SAVE_DEBOUNCE_MS * 2 ** sync.failures);
    const timer = window.setTimeout(() => {
      const layout = viewOf(sync);

      dispatch({ type: "saveStarted" });
      api
        .putLayout(scope, layout, sync.revision, token)
        .then((answer) =>
          dispatch({ type: "saved", revision: answer.layout.revision }),
        )
        .catch((error: unknown) => {
          const status = error instanceof ApiError ? error.status : 0;

          if (status === 409) {
            dispatch({ type: "conflict" });
            void queryClient.invalidateQueries({
              queryKey: queryKeys.canvas(chainId, wallet, selected),
            });

            return;
          }
          dispatch({
            type: "saveFailed",
            status,
            reason: error instanceof Error ? error.message : String(error),
          });
          if (status === 401) apiSessions.drop(chainId);
        });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [scope, chainId, wallet, selected, token, sync, dispatch, queryClient]);

  const update = useCallback<UpdateLayout>(
    (change, options) =>
      dispatch({ type: options?.derived === true ? "derive" : "edit", change }),
    [dispatch],
  );

  const persistence: LayoutPersistence =
    sync.refused !== undefined
      ? { kind: "refused", reason: sync.refused }
      : sync.rejected !== undefined
        ? { kind: "rejected", reason: sync.rejected }
        : isDirty(sync) && token === undefined
          ? { kind: "signIn", signIn: () => void signIn() }
          : isDirty(sync)
            ? { kind: "saving" }
            : { kind: "saved" };

  const layout = useMemo(() => viewOf(sync), [sync]);

  return { layout, update, persistence };
}

/** The canvas layout of `target.account`, from the API in live mode and from browser storage in the sandbox. */
export function useCanvasLayout(target: CanvasLayoutTarget) {
  const { network, account } = target;
  const onApi = network?.kind === "live" && apiUrl !== undefined;
  const key =
    onApi || network === undefined || account === undefined
      ? undefined
      : layoutStorageKey(network.chain.id, account);
  const [browserLayout, updateBrowser] = useBrowserLayout(key);
  const remote = useApiLayout(target, onApi);

  return onApi
    ? ([remote.layout, remote.update, remote.persistence] as const)
    : ([browserLayout, updateBrowser, BROWSER] as const);
}

const BROWSER: LayoutPersistence = { kind: "browser" };
