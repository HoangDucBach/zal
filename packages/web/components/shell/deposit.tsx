"use client";

// The Deposit entry (ADR 0013): bridging is onboarding, not payment, so it is a light item in the profile toolbar,
// not a canvas node. It shows what the canvas holds on the L1 and says bridged USDC comes later. On a live chain it
// also shows the wallet's native gas, offers a gas drip from the API faucet while it is low, and offers the zUSDC
// mint (open mint, testnet only).

import type { Address } from "viem";
import type { ZalNetwork } from "@/config/chains";

import { Button, Popover, Separator } from "@heroui/react";
import { WalletMoneyIcon } from "@solar-icons/react/linear";

import { feedback } from "@/components/canvas/form-parts";
import { Amount, NativeAmount } from "@/components/ui/amount";
import { CopyButton, shortHex } from "@/components/ui/copy-button";
import {
  useDripGas,
  useGasFaucet,
  useNativeBalance,
} from "@/hooks/contracts/gas";
import { useMintTestUsdc } from "@/hooks/contracts/usdc";
import { useCanvasView } from "@/hooks/use-canvas-view";

const FAUCET_AMOUNT = 1_000_000_000n;

function Line({
  label,
  value,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/** A muted address under its balance line, with a copy button. */
function AddressLine({
  label,
  value,
}: {
  readonly label: string;
  readonly value: Address;
}) {
  return (
    <div className="-mt-1 flex items-center justify-end gap-1 text-xs text-muted">
      {shortHex(value)}
      <CopyButton label={`Copy ${label} address`} value={value} />
    </div>
  );
}

/** Live only: the wallet's native gas, and a drip from the API faucet while it is below the faucet's minimum. */
function Gas({
  network,
  wallet,
  children,
}: {
  readonly network: ZalNetwork;
  readonly wallet: Address;
  /** The actions that need gas, rendered once the wallet has some. */
  readonly children: React.ReactNode;
}) {
  const balance = useNativeBalance({ payload: { network, holder: wallet } });
  const faucet = useGasFaucet({ payload: { network } });
  const drip = useDripGas({
    network,
    options: feedback(`${network.chain.nativeCurrency.symbol} received`),
  });
  const symbol = network.chain.nativeCurrency.symbol;
  const status = faucet.data;
  const low =
    balance.data !== undefined &&
    status?.enabled === true &&
    balance.data < status.minBalanceWei;

  return (
    <>
      <Line
        label="Gas"
        value={
          balance.data === undefined ? (
            "…"
          ) : (
            <NativeAmount unit={symbol} value={balance.data} />
          )
        }
      />
      {low ? (
        <Button
          isPending={drip.isPending}
          size="sm"
          variant="primary"
          onPress={() => drip.mutate(wallet)}
        >
          Get gas
        </Button>
      ) : null}
      {balance.data === 0n ? (
        <p className="text-xs text-muted">No {symbol} · get gas first</p>
      ) : (
        children
      )}
    </>
  );
}

export function DepositButton() {
  const { network, canvas, wallet } = useCanvasView();
  const mint = useMintTestUsdc({
    network,
    options: feedback("Minted 1,000 zUSDC"),
  });
  const state = canvas.data;

  if (network === undefined || state === undefined) return null;
  const target = state.account.exists ? "account" : "wallet";
  const mintButton = (
    <Button
      isPending={mint.isPending}
      size="sm"
      variant="secondary"
      onPress={() => mint.mutate({ to: target, amount: FAUCET_AMOUNT })}
    >
      Mint 1,000 zUSDC
    </Button>
  );

  return (
    <Popover>
      <Button className="justify-start" size="sm" variant="ghost">
        <WalletMoneyIcon aria-hidden size={16} />
        Deposit
      </Button>
      <Popover.Content className="w-72">
        <Popover.Dialog>
          <Popover.Heading>Deposit</Popover.Heading>
          <div className="mt-2 flex flex-col gap-2">
            <Line
              label="Canvas"
              value={
                state.account.exists ? (
                  <Amount value={state.account.balance} />
                ) : (
                  "not created"
                )
              }
            />
            {state.account.exists ? (
              <AddressLine label="canvas" value={state.account.address} />
            ) : null}
            <Line
              label="Wallet"
              value={<Amount value={state.lp.walletUsdc} />}
            />
            {wallet === undefined ? null : (
              <AddressLine label="wallet" value={wallet} />
            )}
            <p className="text-xs text-muted">
              {network.kind === "sandbox"
                ? "Sandbox · seeded, no deposit needed"
                : `Mints to your ${target === "account" ? "canvas" : "wallet"} on the Zal L1`}
            </p>
            <Separator />
            <p className="text-xs text-muted">
              Bridged USDC from C-Chain · coming later
            </p>
            {network.kind === "live" && wallet !== undefined ? (
              <Gas network={network} wallet={wallet}>
                {mintButton}
              </Gas>
            ) : null}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
