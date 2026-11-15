"use client";

// The canvas the page shows, from `?account=` so a link opens the same canvas (open question 5). It is only a
// request: the canvas snapshot and every write check on the chain that the wallet may open it (verifyCanvas).
// No `?account=` is the wallet's own canvas.

import { useSearchParams } from "next/navigation";
import { createContext, Suspense, useCallback, useContext } from "react";
import { getAddress, isAddress, type Address } from "viem";

const SelectedAccount = createContext<Address | undefined>(undefined);

export const ACCOUNT_PARAM = "account";

/** `?account=` as an address, or `undefined` when missing or not an address. */
export function parseSelected(value: string | null): Address | undefined {
  return value !== null && isAddress(value, { strict: false })
    ? getAddress(value)
    : undefined;
}

/** Sets the requested canvas for everything below: the URL in the app, a fixed value in tests. */
export function SelectedAccountScope({
  selected,
  children,
}: {
  readonly selected: Address | undefined;
  readonly children?: React.ReactNode;
}) {
  return <SelectedAccount value={selected}>{children}</SelectedAccount>;
}

function FromUrl({ children }: { readonly children: React.ReactNode }) {
  const selected = parseSelected(useSearchParams().get(ACCOUNT_PARAM));

  return (
    <SelectedAccountScope selected={selected}>{children}</SelectedAccountScope>
  );
}

/** Reads `?account=` once for the whole app shell. Prerendering has no URL, so it renders the own canvas. */
export function SelectedAccountProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <Suspense fallback={children}>
      <FromUrl>{children}</FromUrl>
    </Suspense>
  );
}

/** The requested canvas, `undefined` for the wallet's own. */
export function useSelectedAccount(): Address | undefined {
  return useContext(SelectedAccount);
}

/** `path` with the selected canvas kept in the query, so navigating stays on the same canvas. */
export function hrefFor(
  path: string,
  selected: Address | undefined,
  params: Readonly<Record<string, string>> = {},
): string {
  const query = new URLSearchParams(params);

  if (selected !== undefined) query.set(ACCOUNT_PARAM, selected);
  const text = query.toString();

  return text === "" ? path : `${path}?${text}`;
}

export function useAppHref(): (
  path: string,
  params?: Readonly<Record<string, string>>,
) => string {
  const selected = useSelectedAccount();

  return useCallback(
    (path, params) => hrefFor(path, selected, params),
    [selected],
  );
}
