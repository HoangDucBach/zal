"use client";

// The invite link's landing page (PRD R1, ZR-REL-03). It reads the signed invite from the API and shows the
// proposer as a ghost counterparty: an unredeemed invite is off-chain only (ADR 0003). The invitee creates a canvas
// if needed, then redeems the invite with `acceptInvite`, which creates the relationship already Active.

import { Alert, Button, Card, Chip, Spinner } from "@heroui/react";
import { UserPlusIcon } from "@solar-icons/react/linear";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type PublicClient } from "viem";
import { useConfig } from "wagmi";
import { getPublicClient } from "wagmi/actions";

import { feedback } from "@/components/canvas/form-parts";
import { relationshipRegistryAbi } from "@/contracts/abis";
import { useAcceptInvite } from "@/hooks/contracts/canvas-account";
import { useCreateAccount } from "@/hooks/contracts/factory";
import { useCanvasView } from "@/hooks/use-canvas-view";
import { api, apiUrl } from "@/lib/api/client";
import { inviteeRole } from "@/lib/api/invite";
import { formatDate, shortAddress } from "@/lib/format";
import { toAppError, type AppError } from "@/lib/query/errors";
import { queryKeys } from "@/lib/query/keys";

function Notice({
  title,
  children,
  status,
}: {
  readonly title: string;
  readonly children?: React.ReactNode;
  readonly status?: "danger" | "warning" | "success";
}) {
  return (
    <Alert status={status}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        {children === undefined ? null : (
          <Alert.Description>{children}</Alert.Description>
        )}
      </Alert.Content>
    </Alert>
  );
}

export function InviteView({ id }: { readonly id: string }) {
  const router = useRouter();
  const { wallet, network, canvas } = useCanvasView();
  const live = network?.kind === "live" ? network : undefined;
  const invite = useQuery({
    enabled: live !== undefined && apiUrl !== undefined,
    queryKey: queryKeys.invite(live?.chain.id ?? 0, id),
    queryFn: async ({ signal }) => {
      try {
        return (await api.invite(id, signal)).invite;
      } catch (error) {
        throw toAppError(error);
      }
    },
    retry: false,
  });
  const data = invite.data;
  const config = useConfig();
  const used = useQuery<boolean, AppError>({
    enabled: live !== undefined && data !== undefined,
    queryKey: [...queryKeys.invite(live?.chain.id ?? 0, id), "used"],
    queryFn: async () => {
      try {
        if (live === undefined || data === undefined) return false;
        const client = getPublicClient(config, {
          chainId: live.chain.id as never,
        }) as PublicClient | undefined;

        if (client === undefined) throw new Error("No live client.");

        return await client.readContract({
          address: live.addresses.registry,
          abi: relationshipRegistryAbi,
          functionName: "inviteNonceUsed",
          args: [data.proposer, data.nonce],
        });
      } catch (error) {
        throw toAppError(error);
      }
    },
  });
  const create = useCreateAccount({
    network: live,
    options: feedback("Canvas created"),
  });
  const accept = useAcceptInvite({
    network: live,
    options: feedback("Invite accepted · relationship active", () =>
      router.push("/app/canvas"),
    ),
  });

  const state = canvas.data;
  const body = (() => {
    if (network === undefined || apiUrl === undefined)
      return <Notice title="Invites need the live Zal L1 and its API" />;
    if (network.kind === "sandbox")
      return (
        <Notice status="warning" title="Sandbox is on">
          Invites live on the Zal L1 · turn Sandbox off to accept
        </Notice>
      );
    if (invite.isPending) return <Spinner size="sm" />;
    if (invite.error !== null || data === undefined)
      return (
        <Notice status="danger" title="Invite not found">
          {(invite.error as AppError | null)?.message}
        </Notice>
      );
    const role = inviteeRole(data.proposerRole);
    const redeemed = used.data === true;
    const mine =
      state !== undefined &&
      state.account.address.toLowerCase() === data.proposer.toLowerCase();

    return (
      <div className="flex flex-col gap-3">
        <Card
          className={`w-full gap-2 p-3 ${redeemed ? "border border-border" : "border border-dashed border-muted/60"}`}
          data-testid="invite-proposer"
          variant={redeemed ? "default" : "transparent"}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-default text-muted">
              <UserPlusIcon aria-hidden size={16} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium">
                Canvas {shortAddress(data.proposer)}
              </span>
              <span className="truncate text-xs text-muted">
                Your {role === "buyer" ? "seller" : "buyer"} · you join as{" "}
                {role}
              </span>
            </div>
            <Chip size="sm" variant="soft">
              {redeemed ? "redeemed" : "ghost"}
            </Chip>
          </div>
          <span className="text-xs text-muted">
            Signed by {shortAddress(data.signer)} · valid until{" "}
            {formatDate(data.deadline)}
          </span>
        </Card>
        {redeemed ? (
          <Notice status="success" title="Already redeemed">
            The relationship is active on-chain
          </Notice>
        ) : data.expired ? (
          <Notice status="danger" title="The invite has expired" />
        ) : wallet === undefined || state === undefined ? (
          <Notice title="Connect a wallet to accept" />
        ) : mine ? (
          <Notice status="warning" title="That is your own invite">
            Send the link to your counterparty
          </Notice>
        ) : !state.account.exists ? (
          <Button
            isPending={create.isPending}
            size="sm"
            variant="primary"
            onPress={() => create.mutate()}
          >
            Create my canvas
          </Button>
        ) : (
          <Button
            isPending={accept.isPending}
            size="sm"
            variant="primary"
            onPress={() =>
              accept.mutate({
                args: [
                  {
                    proposer: data.proposer,
                    proposerRole: data.proposerRole,
                    inviteeEmailHash: data.inviteeEmailHash,
                    nonce: data.nonce,
                    deadline: BigInt(data.deadline),
                  },
                  data.signature,
                ],
              })
            }
          >
            Accept invite
          </Button>
        )}
        <span className="text-xs text-muted">
          {state?.account.exists === false
            ? "Step 1 of 2 · then accept · active in one transaction"
            : "Ghost until redeemed · then solid on both canvases"}
        </span>
      </div>
    );
  })();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Relationship invite</h1>
        <span className="text-xs text-muted">
          One-for-all canvas · roles live on the relationship
        </span>
      </div>
      {body}
    </div>
  );
}
