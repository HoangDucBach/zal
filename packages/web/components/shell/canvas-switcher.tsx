"use client";

// The canvas switcher (open question 5): the canvas the page shows, "My canvas", then the canvases where the wallet
// holds a role, each with that role as the chain reports it. Anyone can add any wallet to any number of canvases, so
// the list loads a page at a time while it is open, searches by address or name, and keeps canvases the wallet never
// acted on under a collapsed "Added by others". Picking one only navigates (`?account=`); the canvas and every write
// verify it again on the chain.

import type { Membership, MembershipPage } from "@/lib/contracts/memberships";
import type { InfiniteData } from "@tanstack/react-query";

import {
  Button,
  Chip,
  Disclosure,
  Label,
  ListBox,
  Popover,
  SearchField,
  Spinner,
} from "@heroui/react";
import { AltArrowDownIcon } from "@solar-icons/react/linear";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { isAddressEqual } from "viem";

import { CopyButton, shortHex } from "@/components/ui/copy-button";
import { useMemberships, useOwnCanvas } from "@/hooks/contracts/memberships";
import { useCanvasView } from "@/hooks/use-canvas-view";
import { hrefFor } from "@/hooks/use-selected-account";
import { shortAddress } from "@/lib/format";

const CANVAS_PATHS = ["/app/canvas", "/app/overview"];
const ADDRESS_PART = /^(0x)?[0-9a-f]{1,40}$/;

function nameOf(
  membership: Membership,
  labels: Readonly<Record<string, string>>,
): string {
  if (membership.own) return "My canvas";

  return labels[membership.account] ?? shortAddress(membership.account);
}

const roleText = (membership: Membership) =>
  membership.own && !membership.exists ? "not created" : membership.role;

const entriesOf = (data: InfiniteData<MembershipPage> | undefined) =>
  data?.pages.flatMap((page) => page.entries) ?? [];

function CanvasList({
  label,
  entries,
  current,
  labels,
  onPick,
}: {
  readonly label: string;
  readonly entries: readonly Membership[];
  readonly current: Membership | undefined;
  readonly labels: Readonly<Record<string, string>>;
  readonly onPick: (membership: Membership) => void;
}) {
  return (
    <ListBox
      aria-label={label}
      selectedKeys={current === undefined ? [] : [current.account]}
      selectionMode="single"
      onSelectionChange={(keys) => {
        if (keys === "all") return;
        const picked = entries.find((m) => keys.has(m.account));

        if (picked !== undefined) onPick(picked);
      }}
    >
      {entries.map((m) => (
        <ListBox.Item
          key={m.account}
          id={m.account}
          textValue={nameOf(m, labels)}
        >
          <Label>{nameOf(m, labels)}</Label>
          <Chip className="ms-auto" size="sm" variant="soft">
            {roleText(m)}
          </Chip>
          <ListBox.ItemIndicator />
        </ListBox.Item>
      ))}
    </ListBox>
  );
}

function ShowMore({
  pages,
}: {
  readonly pages: ReturnType<typeof useMemberships>;
}) {
  if (pages.isPending) return <Spinner size="sm" />;
  if (pages.isError)
    return <span className="text-xs text-muted">List unavailable</span>;
  if (!pages.hasNextPage) return null;

  return (
    <Button
      isPending={pages.isFetchingNextPage}
      size="sm"
      variant="tertiary"
      onPress={() => void pages.fetchNextPage()}
    >
      Show more
    </Button>
  );
}

export function CanvasSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const { wallet, network, canvas } = useCanvasView();
  const [open, setOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const text = search.trim().toLowerCase();
  // Hex searches the server by address; anything else filters the loaded names.
  const addressPart = ADDRESS_PART.test(text)
    ? text.replace(/^0x/, "")
    : undefined;
  const namePart = text !== "" && addressPart === undefined ? text : undefined;
  const own = useOwnCanvas({ payload: { network, wallet } });
  const acted = useMemberships({
    payload: {
      network,
      wallet,
      group: "acted",
      query: addressPart,
      enabled: open,
    },
  });
  const others = useMemberships({
    payload: {
      network,
      wallet,
      group: "addedByOthers",
      query: addressPart,
      enabled: open && othersOpen,
    },
  });
  const labels = canvas.data?.labels ?? {};
  const shown = canvas.data?.account;
  const current: Membership | undefined =
    shown === undefined
      ? undefined
      : own.data !== undefined &&
          isAddressEqual(own.data.account, shown.address)
        ? own.data
        : {
            account: shown.address,
            role: shown.myRole,
            own: false,
            exists: true,
          };

  if (wallet === undefined || network === undefined) return null;

  const matches = (m: Membership) =>
    (namePart === undefined ||
      nameOf(m, labels).toLowerCase().includes(namePart)) &&
    (addressPart === undefined ||
      !m.own ||
      m.account.toLowerCase().includes(addressPart));
  const mine = own.data === undefined ? [] : [own.data].filter(matches);
  const go = (target: Membership) => {
    const path = CANVAS_PATHS.includes(pathname) ? pathname : "/app/canvas";

    setOpen(false);
    router.push(hrefFor(path, target.own ? undefined : target.account));
  };

  return (
    <Popover isOpen={open} onOpenChange={setOpen}>
      <Button
        fullWidth
        aria-label="Switch canvas"
        className="justify-between"
        data-testid="canvas-switcher"
        size="sm"
        variant="secondary"
      >
        <span className="truncate">
          {current === undefined ? "Canvas" : nameOf(current, labels)}
        </span>
        <span className="flex items-center gap-1">
          {current === undefined ? null : (
            <Chip size="sm" variant="soft">
              {roleText(current)}
            </Chip>
          )}
          <AltArrowDownIcon aria-hidden size={14} />
        </span>
      </Button>
      <Popover.Content className="w-72">
        <Popover.Dialog aria-label="Canvases" className="flex flex-col gap-2">
          {shown === undefined ? null : (
            <div className="flex items-center justify-between gap-2 px-1 text-xs">
              <span className="text-muted">Open</span>
              <span className="flex items-center gap-1">
                {shortHex(shown.address)}
                <CopyButton label="Copy canvas address" value={shown.address} />
              </span>
            </div>
          )}
          <SearchField
            aria-label="Search canvases"
            value={search}
            onChange={setSearch}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Address or name" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <CanvasList
            current={current}
            entries={[...mine, ...entriesOf(acted.data).filter(matches)]}
            label="Canvases"
            labels={labels}
            onPick={go}
          />
          <ShowMore pages={acted} />
          <Disclosure isExpanded={othersOpen} onExpandedChange={setOthersOpen}>
            <Disclosure.Heading>
              <Button fullWidth size="sm" slot="trigger" variant="ghost">
                Added by others · never acted on
                <Disclosure.Indicator />
              </Button>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="flex flex-col gap-2">
                <CanvasList
                  current={current}
                  entries={entriesOf(others.data).filter(matches)}
                  label="Canvases added by others"
                  labels={labels}
                  onPick={go}
                />
                <ShowMore pages={others} />
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
