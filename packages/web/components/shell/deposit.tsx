"use client";

// The Deposit entry (ADR 0013): bridging is onboarding, not payment, so it is a light item in the profile toolbar,
// not a canvas node. It shows what the canvas holds on the L1 and says bridged USDC comes later. On the local anvil
// chain it also offers the zUSDC faucet (open mint, testnet only).

import { Button, Popover, Separator } from "@heroui/react";
import { WalletMoneyIcon } from "@solar-icons/react/linear";

import { feedback } from "@/components/canvas/form-parts";
import { useMintTestUsdc } from "@/hooks/contracts/usdc";
import { useCanvasView } from "@/hooks/use-canvas-view";
import { Amount } from "@/components/ui/amount";

/** Anvil's chain id: the only live chain where a faucet makes sense. */
const LOCAL_CHAIN_ID = 31_337;
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

export function DepositButton() {
  const { network, canvas } = useCanvasView();
  const mint = useMintTestUsdc({
    network,
    options: feedback("Minted 1,000 testnet zUSDC"),
  });
  const state = canvas.data;

  if (network === undefined || state === undefined) return null;
  const faucet = network.kind === "live" && network.chain.id === LOCAL_CHAIN_ID;
  const target = state.account.exists ? "account" : "wallet";

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
            <Line
              label="Wallet"
              value={<Amount value={state.lp.walletUsdc} />}
            />
            <p className="text-xs text-muted">
              {network.kind === "sandbox"
                ? "Sandbox USDC · seeded, no deposit needed"
                : "zUSDC (testnet) on the Zal L1"}
            </p>
            <Separator />
            <p className="text-xs text-muted">
              Bridged USDC from C-Chain (ICTT) · coming later
            </p>
            {faucet ? (
              <Button
                isPending={mint.isPending}
                size="sm"
                variant="secondary"
                onPress={() =>
                  mint.mutate({ to: target, amount: FAUCET_AMOUNT })
                }
              >
                Mint 1,000 testnet zUSDC to{" "}
                {target === "account" ? "canvas" : "wallet"}
              </Button>
            ) : null}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
