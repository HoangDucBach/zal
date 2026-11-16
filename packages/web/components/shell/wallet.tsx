"use client";

// The wallet row in the sidebar footer and its popover: the canvas account this page shows (its address and zUSDC,
// the money that moves), then the connected wallet (its address and native gas), then the network.

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";

import { Avatar, Button, Chip, Popover, Separator } from "@heroui/react";
import { LogoutIcon } from "@solar-icons/react/linear";

import { AuroraGlow } from "@/components/ui/aurora-glow";
import { liveNetwork } from "@/config/chains";
import { Amount, NativeAmount } from "@/components/ui/amount";
import { CopyButton, shortHex } from "@/components/ui/copy-button";
import { useNativeBalance } from "@/hooks/contracts/gas";
import { useCanvasView } from "@/hooks/use-canvas-view";
import { useSandboxMode } from "@/lib/sandbox/mode";
import { useSandboxSession } from "@/lib/sandbox/session";

interface NetworkStatus {
  readonly label: string;
  readonly color: "warning" | "success" | "danger";
  readonly reason?: string;
}

/** The network the app talks to: the sandbox, the live L1, or why the live L1 is unavailable. */
function useNetworkStatus(): NetworkStatus {
  const mode = useSandboxMode();
  const session = useSandboxSession();

  if (mode.enabled)
    return {
      label: session.phase === "loading" ? "Sandbox starting…" : "Sandbox",
      color: "warning",
    };
  if (liveNetwork.status === "ready")
    return { label: liveNetwork.chain.name, color: "success" };

  return {
    label: "Live unavailable",
    color: "danger",
    reason: liveNetwork.reason,
  };
}

function CanvasCard() {
  const { canvas } = useCanvasView();
  const account = canvas.data?.account;

  return (
    <div className="dark relative isolate flex flex-col gap-1 overflow-hidden rounded-xl p-3 pb-8 text-foreground">
      <AuroraGlow />
      <span className="text-xs font-medium text-foreground/80">
        Canvas account
      </span>
      {account === undefined ? (
        <span className="text-sm text-muted">Loading…</span>
      ) : account.exists ? (
        <>
          <span className="flex items-center gap-1">
            <span className="text-base font-semibold text-foreground">
              {shortHex(account.address)}
            </span>
            <CopyButton label="Copy canvas address" value={account.address} />
          </span>
          <Amount precision="cents" size="figure" value={account.balance} />
        </>
      ) : (
        <span className="text-sm text-muted">Not created</span>
      )}
    </div>
  );
}

function Gas({
  network,
  wallet,
}: {
  readonly network: ZalNetwork;
  readonly wallet: Address;
}) {
  const balance = useNativeBalance({ payload: { network, holder: wallet } });

  return (
    <span className="text-xs">
      {balance.data === undefined ? (
        "…"
      ) : (
        <NativeAmount
          unit={network.chain.nativeCurrency.symbol}
          value={balance.data}
        />
      )}
    </span>
  );
}

function WalletLine({ wallet }: { readonly wallet: Address }) {
  const { network } = useCanvasView();

  return (
    <div className="flex flex-col px-1">
      <span className="text-xs text-muted">Wallet</span>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          <span className="text-sm text-muted">{shortHex(wallet)}</span>
          <CopyButton label="Copy wallet address" value={wallet} />
        </span>
        {network === undefined ? null : (
          <Gas network={network} wallet={wallet} />
        )}
      </div>
    </div>
  );
}

/** The sidebar's wallet row; opens the canvas account, the wallet and the network. */
export function WalletPopover({
  wallet,
  compact = false,
  onDisconnect,
}: {
  readonly wallet: Address;
  /** The collapsed sidebar: the avatar only. */
  readonly compact?: boolean;
  readonly onDisconnect: () => void;
}) {
  const network = useNetworkStatus();

  return (
    <Popover>
      {compact ? (
        <Button
          isIconOnly
          aria-label="Wallet details"
          className="size-auto p-0.5"
          size="sm"
          variant="ghost"
        >
          <Avatar color="accent" size="sm" variant="soft">
            <Avatar.Fallback>
              {wallet.slice(2, 4).toUpperCase()}
            </Avatar.Fallback>
          </Avatar>
        </Button>
      ) : (
        <Button
          fullWidth
          aria-label="Wallet details"
          className="h-auto justify-start gap-2 py-1.5 text-start"
          size="sm"
          variant="ghost"
        >
          <Avatar color="accent" size="sm" variant="soft">
            <Avatar.Fallback>
              {wallet.slice(2, 4).toUpperCase()}
            </Avatar.Fallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">
              {shortHex(wallet)}
            </span>
            <span className="text-xs text-muted">Wallet</span>
          </span>
          <Chip color={network.color} size="sm" variant="soft">
            {network.label}
          </Chip>
        </Button>
      )}
      <Popover.Content className="w-80" placement="right bottom">
        <Popover.Dialog aria-label="Wallet" className="flex flex-col gap-3">
          <CanvasCard />
          <WalletLine wallet={wallet} />
          <div className="flex items-center justify-between gap-2 px-1 text-xs">
            <span className="text-muted">Network</span>
            <Chip color={network.color} size="sm" variant="soft">
              {network.label}
            </Chip>
          </div>
          {network.reason === undefined ? null : (
            <p className="px-1 text-xs text-muted">{network.reason}</p>
          )}
          <Separator />
          <Button size="sm" variant="ghost" onPress={onDisconnect}>
            <LogoutIcon aria-hidden size={16} />
            Disconnect
          </Button>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
