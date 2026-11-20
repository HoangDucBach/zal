"use client";

// The profile toolbar in the sidebar footer: the wallet (a popover with the canvas account and the wallet), the
// Sandbox switch, the theme, and disconnect. It changes how the app connects, never the chain, so it lives in the shell (PRD principle 1).

import {
  LogoutIcon,
  MoonIcon,
  PlugIcon,
  SunIcon,
} from "@solar-icons/react/linear";
import { Button, Link, Popover, Switch, toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
  ProviderNotFoundError,
  useConfig,
  useConnect,
  useConnections,
  useConnectors,
  useDisconnect,
} from "wagmi";

import { DepositButton } from "./deposit";
import { RailTooltip } from "./rail-tooltip";
import { WalletPopover } from "./wallet";

import { liveNetwork } from "@/config/chains";
import { Spotlight } from "@/components/ui/spotlight";
import { apiSessions } from "@/lib/api/session";
import { toAppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import { SANDBOX_CONNECTOR_ID } from "@/lib/sandbox/connector";
import { useSandboxMode } from "@/lib/sandbox/mode";
import { enterSandbox, exitSandbox } from "@/lib/sandbox/session";

const ICON = { size: 16, "aria-hidden": true } as const;

/** Browser wallets that run on the Zal L1, offered when the browser has none. */
const WALLET_DOWNLOADS = [
  { name: "Core", href: "https://core.app/download" },
  { name: "MetaMask", href: "https://metamask.io/download/" },
] as const;

type Connector = ReturnType<typeof useConnectors>[number];

/**
 * Whether the browser has a wallet for the injected connector: wagmi always lists that connector, with or
 * without an extension, so connecting without one fails with "Provider not found". Undefined while checking.
 */
function useHasProvider(connector: Connector | undefined): boolean | undefined {
  const [found, setFound] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    if (connector === undefined) return;
    let live = true;
    const check = () =>
      void connector
        .getProvider()
        .then((provider) => live && setFound(provider !== undefined))
        .catch(() => live && setFound(false));

    check();
    // Some extensions inject after the page loads and announce it with this event.
    window.addEventListener("ethereum#initialized", check, { once: true });

    return () => {
      live = false;
      window.removeEventListener("ethereum#initialized", check);
    };
  }, [connector]);

  return connector === undefined ? false : found;
}

/** The Connect button when the browser has no wallet: it opens download links instead of failing. */
function InstallWallet({
  compact,
  isOpen,
  onOpenChange,
}: {
  readonly compact: boolean;
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [button, setButton] = useState<HTMLButtonElement | null>(null);

  return (
    <Popover isOpen={isOpen} onOpenChange={onOpenChange}>
      {button === null ? null : <Spotlight shown={isOpen} target={button} />}
      <Button
        ref={setButton}
        aria-label="Connect wallet"
        fullWidth={!compact}
        isIconOnly={compact}
        size="sm"
        variant="primary"
      >
        <PlugIcon {...ICON} />
        {compact ? null : "Connect wallet"}
      </Button>
      <Popover.Content
        className="w-64"
        placement={compact ? "right bottom" : "top"}
      >
        <Popover.Dialog>
          <Popover.Heading>No wallet found</Popover.Heading>
          <p className="mt-1 text-xs text-muted">
            Install one, then reload this page
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {WALLET_DOWNLOADS.map((wallet) => (
              <Link
                key={wallet.name}
                className="text-sm"
                href={wallet.href}
                rel="noopener noreferrer"
                target="_blank"
              >
                Get {wallet.name}
                <Link.Icon />
              </Link>
            ))}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}

/** The wallet the visitor connected, never the sandbox connector that impersonates it. */
export function useRealWallet() {
  const connections = useConnections();

  return connections.find((c) => c.connector.id !== SANDBOX_CONNECTOR_ID);
}

/** Leaves the sandbox, ends the API session, then disconnects the wallet. */
function useDisconnectWallet(): () => Promise<void> {
  const config = useConfig();
  const wallet = useRealWallet();
  const disconnect = useDisconnect();

  return async () => {
    if (wallet === undefined) return;
    await exitSandbox(config);
    if (liveNetwork.status === "ready")
      await apiSessions.signOut(liveNetwork.chain.id);
    disconnect.mutate({ connector: wallet.connector });
  };
}

function ThemeToggle({ compact }: { readonly compact: boolean }) {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const label = dark ? "Switch to light theme" : "Switch to dark theme";

  return (
    <RailTooltip label={label} shown={compact}>
      <Button
        isIconOnly
        aria-label={label}
        size="sm"
        variant="ghost"
        onPress={() => setTheme(dark ? "light" : "dark")}
      >
        {dark ? <SunIcon {...ICON} /> : <MoonIcon {...ICON} />}
      </Button>
    </RailTooltip>
  );
}

function SandboxSwitch({ compact }: { readonly compact: boolean }) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const wallet = useRealWallet();
  const mode = useSandboxMode();
  const [busy, setBusy] = useState(false);

  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      if (on && wallet !== undefined)
        await enterSandbox(config, wallet.accounts[0]);
      else await exitSandbox(config);
      await queryClient.invalidateQueries({ queryKey: queryKeys.all });
    } catch (error) {
      toast.danger(toAppError(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RailTooltip label="Sandbox" shown={compact}>
      <Switch
        aria-label={compact ? "Sandbox" : undefined}
        isDisabled={wallet === undefined || busy}
        isSelected={mode.enabled}
        size="sm"
        onChange={(on) => void toggle(on)}
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          {compact ? null : "Sandbox"}
        </Switch.Content>
      </Switch>
    </RailTooltip>
  );
}

/** "Try sandbox" links carry `?sandbox=1`: once a wallet is connected, the sandbox turns on by itself. */
export function SandboxAutostart() {
  const params = useSearchParams();
  const router = useRouter();
  const config = useConfig();
  const wallet = useRealWallet();
  const mode = useSandboxMode();
  const started = useRef(false);
  const wanted = params.get("sandbox") === "1";

  useEffect(() => {
    if (!wanted || wallet === undefined || started.current) return;
    started.current = true;
    const next = new URLSearchParams(params);

    next.delete("sandbox");
    const clean = () =>
      router.replace(
        `${window.location.pathname}${next.size > 0 ? `?${next}` : ""}`,
      );

    if (mode.enabled) {
      clean();

      return;
    }
    enterSandbox(config, wallet.accounts[0])
      .then(clean)
      .catch((error: unknown) => toast.danger(toAppError(error).message));
  }, [wanted, wallet, mode.enabled, config, params, router]);

  return null;
}

export function ProfileToolbar({
  compact = false,
}: {
  /** The collapsed sidebar: icons in one column, labels in tooltips. */
  readonly compact?: boolean;
}) {
  const wallet = useRealWallet();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnectWallet();
  const injected = connectors.find((c) => c.type === "injected");
  const hasProvider = useHasProvider(injected);
  // Also set when connecting fails for want of a provider, in case the check above was too early or too late.
  const [noProvider, setNoProvider] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  const connectButton =
    hasProvider === false || noProvider ? (
      <InstallWallet
        compact={compact}
        isOpen={installOpen}
        onOpenChange={setInstallOpen}
      />
    ) : (
      <Button
        aria-label="Connect wallet"
        fullWidth={!compact}
        isDisabled={injected === undefined}
        isIconOnly={compact}
        isPending={connect.isPending}
        size="sm"
        variant="primary"
        onPress={() =>
          injected !== undefined &&
          connect.mutate(
            { connector: injected },
            {
              onError: (error) => {
                if (error instanceof ProviderNotFoundError) {
                  setNoProvider(true);
                  setInstallOpen(true);

                  return;
                }
                toast.danger(toAppError(error).message);
              },
            },
          )
        }
      >
        <PlugIcon {...ICON} />
        {compact ? null : "Connect wallet"}
      </Button>
    );
  const disconnectButton = (
    <RailTooltip label="Disconnect wallet" shown={compact}>
      <Button
        isIconOnly
        aria-label="Disconnect wallet"
        size="sm"
        variant="ghost"
        onPress={() => void disconnect()}
      >
        <LogoutIcon {...ICON} />
      </Button>
    </RailTooltip>
  );

  if (compact)
    return (
      <div className="flex flex-col items-center gap-2">
        {wallet === undefined ? (
          <RailTooltip shown label="Connect wallet">
            {connectButton}
          </RailTooltip>
        ) : (
          <>
            <WalletPopover
              compact
              wallet={wallet.accounts[0]}
              onDisconnect={() => void disconnect()}
            />
            <DepositButton compact />
          </>
        )}
        <SandboxSwitch compact />
        <ThemeToggle compact />
        {wallet === undefined ? null : disconnectButton}
      </div>
    );

  if (wallet === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {connectButton}
        <div className="flex items-center justify-between gap-2">
          <SandboxSwitch compact={false} />
          <ThemeToggle compact={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <WalletPopover
        wallet={wallet.accounts[0]}
        onDisconnect={() => void disconnect()}
      />
      <DepositButton />
      <div className="flex items-center justify-between gap-1">
        <SandboxSwitch compact={false} />
        <div className="flex items-center">
          <ThemeToggle compact={false} />
          {disconnectButton}
        </div>
      </div>
    </div>
  );
}
