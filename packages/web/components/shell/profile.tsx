"use client";

// The profile toolbar in the sidebar footer: the wallet, the network, the Sandbox switch, the theme, and
// disconnect. It changes how the app connects, never the chain, so it lives in the shell (PRD principle 1).

import {
  LogoutIcon,
  MoonIcon,
  PlugIcon,
  SunIcon,
} from "@solar-icons/react/linear";
import { Avatar, Button, Chip, Switch, Tooltip, toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import {
  useConfig,
  useConnect,
  useConnections,
  useConnectors,
  useDisconnect,
} from "wagmi";

import { DepositButton } from "./deposit";

import { liveNetwork } from "@/config/chains";
import { apiSessions } from "@/lib/api/session";
import { shortAddress } from "@/lib/format";
import { toAppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";
import { SANDBOX_CONNECTOR_ID } from "@/lib/sandbox/connector";
import { useSandboxMode } from "@/lib/sandbox/mode";
import {
  enterSandbox,
  exitSandbox,
  useSandboxSession,
} from "@/lib/sandbox/session";

const ICON = { size: 16, "aria-hidden": true } as const;

/** The wallet the visitor connected, never the sandbox connector that impersonates it. */
export function useRealWallet() {
  const connections = useConnections();

  return connections.find((c) => c.connector.id !== SANDBOX_CONNECTOR_ID);
}

function NetworkChip() {
  const mode = useSandboxMode();
  const session = useSandboxSession();

  if (mode.enabled) {
    return (
      <Chip color="warning" size="sm" variant="soft">
        {session.phase === "loading" ? "Sandbox starting…" : "Sandbox"}
      </Chip>
    );
  }
  if (liveNetwork.status === "ready") {
    return (
      <Chip color="success" size="sm" variant="soft">
        {liveNetwork.chain.name}
      </Chip>
    );
  }

  return (
    <Tooltip delay={0}>
      <Button aria-label="Live network unavailable" size="sm" variant="ghost">
        Live unavailable
      </Button>
      <Tooltip.Content>
        <p>{liveNetwork.reason}</p>
      </Tooltip.Content>
    </Tooltip>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  return (
    <Button
      isIconOnly
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      size="sm"
      variant="ghost"
      onPress={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <SunIcon {...ICON} /> : <MoonIcon {...ICON} />}
    </Button>
  );
}

function SandboxSwitch() {
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
    <Switch
      isDisabled={wallet === undefined || busy}
      isSelected={mode.enabled}
      size="sm"
      onChange={(on) => void toggle(on)}
    >
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        Sandbox
      </Switch.Content>
    </Switch>
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

export function ProfileToolbar() {
  const config = useConfig();
  const wallet = useRealWallet();
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const injected = connectors.find((c) => c.type === "injected");

  if (wallet === undefined) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          fullWidth
          isDisabled={injected === undefined}
          isPending={connect.isPending}
          size="sm"
          variant="primary"
          onPress={() =>
            injected !== undefined &&
            connect.mutate(
              { connector: injected },
              { onError: (error) => toast.danger(toAppError(error).message) },
            )
          }
        >
          <PlugIcon {...ICON} />
          Connect wallet
        </Button>
        <div className="flex items-center justify-between gap-2">
          <SandboxSwitch />
          <ThemeToggle />
        </div>
      </div>
    );
  }
  const address = wallet.accounts[0];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Avatar color="accent" size="sm" variant="soft">
          <Avatar.Fallback>{address.slice(2, 4).toUpperCase()}</Avatar.Fallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium">
            {shortAddress(address)}
          </span>
          <span className="text-xs text-muted">Wallet</span>
        </div>
        <NetworkChip />
      </div>
      <DepositButton />
      <div className="flex items-center justify-between gap-1">
        <SandboxSwitch />
        <div className="flex items-center">
          <ThemeToggle />
          <Button
            isIconOnly
            aria-label="Disconnect wallet"
            size="sm"
            variant="ghost"
            onPress={async () => {
              await exitSandbox(config);
              if (liveNetwork.status === "ready")
                await apiSessions.signOut(liveNetwork.chain.id);
              disconnect.mutate({ connector: wallet.connector });
            }}
          >
            <LogoutIcon {...ICON} />
          </Button>
        </div>
      </div>
    </div>
  );
}
