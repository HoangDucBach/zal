"use client";

// Notifications as a system (PRD principle 5): live on every app page. A new one raises a toast and makes the
// canvas Inbox glow until it is seen. Live mode reads the feed and the wallet's read state from the API;
// the sandbox derives the feed from the events the canvas already reads. Read state is always kept per chain and
// wallet in browser storage too, so reading works signed out; once signed in, it is also sent to the API.

import type { CanvasNotification } from "@/lib/canvas/notifications";

import { toast } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AmountsInText } from "@/components/ui/amount";
import { usePresentationEpoch } from "@/lib/canvas/presentation";
import { useApiSignIn } from "@/hooks/use-api-session";
import { useCanvasView } from "@/hooks/use-canvas-view";
import { useAppHref } from "@/hooks/use-selected-account";
import { api, apiUrl } from "@/lib/api/client";
import { apiSessions } from "@/lib/api/session";
import { ApiError, toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import {
  arrivals,
  deriveNotifications,
  notificationsStorageKey,
  parseReadKeys,
  serializeReadKeys,
} from "@/lib/canvas/notifications";

interface FocusRequest {
  readonly nodeId: string;
  /** Bumps on every request, so asking for the same node twice flies there twice. */
  readonly nonce: number;
}

interface NotificationsValue {
  readonly feed: readonly CanvasNotification[];
  readonly isRead: (key: string) => boolean;
  readonly unreadCount: number;
  /** Something arrived since the Inbox was last looked at. */
  readonly fresh: boolean;
  readonly acknowledge: () => void;
  readonly markRead: (key: string) => void;
  readonly markAllRead: () => void;
  readonly focusRequest: FocusRequest | undefined;
  /** Opens the canvas at a node, from anywhere in the app. */
  readonly flyTo: (nodeId: string) => void;
}

const NONE: readonly CanvasNotification[] = [];

const Context = createContext<NotificationsValue>({
  feed: NONE,
  isRead: () => true,
  unreadCount: 0,
  fresh: false,
  acknowledge: () => undefined,
  markRead: () => undefined,
  markAllRead: () => undefined,
  focusRequest: undefined,
  flyTo: () => undefined,
});

export const useNotifications = (): NotificationsValue => use(Context);

function loadRead(key: string | undefined): ReadonlySet<string> {
  if (key === undefined || typeof window === "undefined") return new Set();
  try {
    return parseReadKeys(window.localStorage.getItem(key));
  } catch {
    return new Set();
  }
}

export function NotificationsProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { wallet, network, selected, canvas } = useCanvasView();
  const href = useAppHref();
  const key =
    wallet === undefined || network === undefined
      ? undefined
      : notificationsStorageKey(network.chain.id, wallet, selected);
  const account = canvas.data?.account.address;
  const fromApi = network?.kind === "live" && apiUrl !== undefined;
  const served = useQuery<
    { feed: CanvasNotification[]; read: ReadonlySet<string> },
    AppError
  >({
    enabled: fromApi && account !== undefined && wallet !== undefined,
    queryKey:
      network === undefined || wallet === undefined || account === undefined
        ? queryKeys.all
        : queryKeys.notifications(network.chain.id, wallet, account),
    queryFn: async ({ signal }) => {
      try {
        if (account === undefined || wallet === undefined)
          throw new Error("No account.");
        const answer = await api.notifications(account, wallet, signal);

        return {
          feed: answer.notifications.map(({ read: _, ...n }) => n),
          read: new Set(
            answer.notifications.filter((n) => n.read).map((n) => n.key),
          ),
        };
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
  const derived = useMemo(
    () =>
      canvas.data === undefined ? undefined : deriveNotifications(canvas.data),
    [canvas.data],
  );
  // While the API is down the canvas falls back to the chain, and so does the feed.
  const feed =
    fromApi && served.data !== undefined ? served.data.feed : derived;
  const serverRead = served.data?.read;
  const signIn = useApiSignIn(network, wallet);
  const token =
    signIn.state.status === "signedIn" ? signIn.state.session.token : undefined;
  const chainId = network?.chain.id;
  const sendRead = useCallback(
    (keys: readonly string[]) => {
      if (token === undefined || chainId === undefined || keys.length === 0)
        return;
      api.markRead(keys.slice(0, 500), token).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401)
          apiSessions.drop(chainId);
      });
    },
    [token, chainId],
  );
  // A sandbox Reset clears the stored read state; the epoch makes this copy reload instead of saving it back.
  const epoch = usePresentationEpoch();
  const [read, setRead] = useState(() => ({
    key,
    epoch,
    keys: loadRead(key),
  }));
  const [fresh, setFresh] = useState(false);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | undefined>();
  const seen = useRef<{
    key: string | undefined;
    feed: readonly CanvasNotification[] | undefined;
  }>({ key: undefined, feed: undefined });

  if (read.key !== key || read.epoch !== epoch) {
    setRead({ key, epoch, keys: loadRead(key) });
  }

  const flyTo = useCallback(
    (nodeId: string) => {
      setFocusRequest((previous) => ({
        nodeId,
        nonce: (previous?.nonce ?? 0) + 1,
      }));
      if (pathname !== "/app/canvas") router.push(href("/app/canvas"));
    },
    [pathname, router, href],
  );

  const persist = useCallback(
    (keys: ReadonlySet<string>) => {
      if (key === undefined || feed === undefined) return;
      try {
        window.localStorage.setItem(key, serializeReadKeys(keys, feed));
      } catch {
        // Storage blocked: read state lasts for this session.
      }
    },
    [key, feed],
  );

  const markRead = useCallback(
    (item: string) => {
      sendRead([item]);
      setRead((previous) => {
        if (previous.keys.has(item)) return previous;
        const keys = new Set([...previous.keys, item]);

        persist(keys);

        return { ...previous, keys };
      });
    },
    [persist, sendRead],
  );
  const markAllRead = useCallback(() => {
    const keys = new Set((feed ?? NONE).map((n) => n.key));

    sendRead([...keys].filter((k) => serverRead?.has(k) !== true));
    persist(keys);
    setRead((previous) => ({ ...previous, keys }));
    setFresh(false);
  }, [feed, persist, sendRead, serverRead]);

  // On sign-in, what was read signed out reaches the API too, so other browsers see it.
  useEffect(() => {
    if (serverRead === undefined || feed === undefined) return;
    sendRead(
      feed
        .map((n) => n.key)
        .filter((k) => read.keys.has(k) && !serverRead.has(k)),
    );
    // Only a new session (token) triggers this; later reads are sent as they happen.
  }, [token]);

  // Arrivals: only after the first read for this wallet, so history already on the chain does not toast.
  useEffect(() => {
    if (feed === undefined) return;
    const previous = seen.current;
    // After a sandbox Reset (a new epoch) the reseeded chain's history is not news either.
    const scope = `${key ?? ""}#${epoch}`;

    seen.current = { key: scope, feed };
    if (previous.key !== scope || previous.feed === undefined) return;
    const fresh = arrivals(previous.feed, feed);

    if (fresh.length === 0) return;
    setFresh(true);
    for (const n of fresh.slice(0, 3)) {
      const id = toast(n.title, {
        description: <AmountsInText text={n.detail} />,
        variant: "accent",
        timeout: 6000,
        actionProps: {
          children: "Show",
          onPress: () => {
            toast.close(id);
            flyTo(n.nodeId);
          },
        },
      });
    }
  }, [feed, key, epoch, flyTo]);

  const list = feed ?? NONE;
  const value = useMemo<NotificationsValue>(() => {
    const isRead = (item: string) =>
      read.keys.has(item) || serverRead?.has(item) === true;

    return {
      feed: list,
      isRead,
      unreadCount: list.filter((n) => !isRead(n.key)).length,
      fresh,
      acknowledge: () => setFresh(false),
      markRead,
      markAllRead,
      focusRequest,
      flyTo,
    };
  }, [
    list,
    read.keys,
    serverRead,
    fresh,
    markRead,
    markAllRead,
    focusRequest,
    flyTo,
  ]);

  return <Context value={value}>{children}</Context>;
}
