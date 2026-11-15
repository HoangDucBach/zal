"use client";

// The header on every explorer page: the title, the network chips, and search (⌘K). A direct hit (an address or a
// block number) opens at once; a hash or text asks /v1/explorer/search.

import { Alert, Card, Chip, Kbd, Link, SearchField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Empty, shortHex } from "./parts";

import { liveNetwork } from "@/config/chains";
import { explorerEnabled, useExplorerSearch } from "@/hooks/use-explorer";
import { classifySearch, directHref, resultHref } from "@/lib/explorer/search";
import { useSandboxMode } from "@/lib/sandbox/mode";

const invoices =
  liveNetwork.status === "ready" ? liveNetwork.addresses.invoices : undefined;

function Search() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [asked, setAsked] = useState<
    { readonly q: string; readonly hash: boolean } | undefined
  >(undefined);
  const search = useExplorerSearch(asked?.q);
  const results = search.data?.results;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A hash names one tx or one block: open it as soon as the API says which.
  useEffect(() => {
    const only = results?.length === 1 ? results[0] : undefined;

    if (asked?.hash !== true || only === undefined) return;
    const href = resultHref(only, invoices);

    if (href !== undefined) router.push(href);
  }, [asked, results, router]);

  const submit = (text: string) => {
    const query = classifySearch(text);
    const href = directHref(query);

    if (href !== undefined) router.push(href);
    setAsked(
      query.kind === "hash"
        ? { q: query.hash, hash: true }
        : query.kind === "text"
          ? { q: query.text, hash: false }
          : undefined,
    );
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <SearchField
        fullWidth
        aria-label="Search the Zal L1"
        name="q"
        value={value}
        onChange={setValue}
        onClear={() => setAsked(undefined)}
        onSubmit={submit}
      >
        <SearchField.Group>
          <SearchField.SearchIcon />
          <SearchField.Input
            ref={input}
            placeholder="Address · tx hash · block · token · #invoice"
          />
          <SearchField.ClearButton />
          <Kbd className="me-2 hidden sm:inline-flex">
            <Kbd.Abbr keyValue="command" />
            <Kbd.Content>K</Kbd.Content>
          </Kbd>
        </SearchField.Group>
      </SearchField>
      {asked === undefined ? null : (
        <Card className="gap-1 p-2" variant="secondary">
          {search.isPending ? (
            <Empty>Searching…</Empty>
          ) : search.isError ? (
            <Empty>{search.error.message}</Empty>
          ) : results === undefined || results.length === 0 ? (
            <Empty>No match</Empty>
          ) : (
            <ul aria-label="Search results" className="flex flex-col">
              {results.map((r) => {
                const href = resultHref(r, invoices);

                return (
                  <li
                    key={`${r.type}:${r.id}`}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5"
                  >
                    <Chip size="sm" variant="soft">
                      {r.type}
                    </Chip>
                    {href === undefined ? (
                      <span className="text-sm">{r.label ?? r.id}</span>
                    ) : (
                      <Link className="text-sm" href={href}>
                        {r.label ?? shortHex(r.id, 10, 6)}
                      </Link>
                    )}
                    {r.label === null ? null : (
                      <span className="ml-auto font-mono text-xs text-muted">
                        {shortHex(r.id, 10, 6)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

export function ExplorerHeader({
  eyebrow,
  title,
  children,
}: {
  /** The page kind: Explorer, Address, Transaction, Block, Token. */
  readonly eyebrow: string;
  readonly title: React.ReactNode;
  /** Chips and actions after the title. */
  readonly children?: React.ReactNode;
}) {
  const sandbox = useSandboxMode().enabled;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            className="w-fit font-mono text-xs uppercase tracking-widest text-muted"
            href="/app/explorer"
          >
            {eyebrow}
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-all text-2xl font-light">{title}</h1>
            {children}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {sandbox ? (
            <Chip color="accent" size="sm" variant="soft">
              live L1
            </Chip>
          ) : null}
          <Chip size="sm" variant="soft">
            {liveNetwork.status === "ready"
              ? `${liveNetwork.chain.name} · ${liveNetwork.chain.id}`
              : "testnet"}
          </Chip>
        </div>
      </div>
      {explorerEnabled ? (
        <Search />
      ) : (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>No explorer API</Alert.Title>
            <Alert.Description>
              NEXT_PUBLIC_ZAL_API_URL not set
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}

/** The page frame every explorer page shares. */
export function ExplorerPage({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      {children}
    </div>
  );
}
