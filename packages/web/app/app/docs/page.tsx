import { Card, Chip } from "@heroui/react";

export const metadata = { title: "Docs" };

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <Card className="gap-3 p-5">
      <Card.Header>
        <Card.Title className="text-base">{title}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3 text-sm">
        {children}
      </Card.Content>
    </Card>
  );
}

function Steps({ items }: { readonly items: readonly React.ReactNode[] }) {
  return (
    <ol className="flex list-decimal flex-col gap-2 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

const b = (text: string) => <span className="font-semibold">{text}</span>;

export default function DocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Docs</h1>
        <span className="text-sm text-muted">
          Getting started, and the sandbox demo step by step.
        </span>
      </div>

      <Section title="Getting started">
        <Steps
          items={[
            <>
              {b("Connect a wallet")} from the sidebar footer. Your canvas is
              the Zal account that wallet controls.
            </>,
            <>
              {b("Turn on Sandbox")} in the same footer. The real contracts
              start in your browser, your account is created and funded with
              10,000 testnet zUSDC, and your wallet gets 5,000 for the LP role.
              Nothing is signed and nothing costs gas.
            </>,
            <>
              {b("Open Canvas.")} The palette on the left lists the components
              that fit what you selected. Click one, or drag it onto the canvas
              or onto a node. Its form opens in the Inspector on the right.
            </>,
            <>
              {b("Watch ghost turn solid.")} Dashed, faded nodes are not
              committed yet. They turn solid when the other side signs on-chain.
            </>,
            <>
              {b("Use Overview")} to see balances, what waits for you, and
              invoices by status. Each row opens the canvas at its node.
            </>,
          ]}
        />
      </Section>

      <Section title="Sandbox demo: you are the seller">
        <p className="text-muted">
          The eight PRD demo steps. The Guided demo panel on the canvas ticks
          each one off from chain state and shows what to do next.
        </p>
        <Steps
          items={[
            <>
              Select nothing and add a {b("Split")} from the palette: 10% to the
              Vault (simulated yield), 90% held. Save it, then switch the{" "}
              {b("Split visibility")} to public.
            </>,
            <>
              Add a {b("Counterparty")}: use the demo club and choose{" "}
              {b("You are the seller")}. The club shows as a ghost.
            </>,
            <>The demo club accepts on its own. Both nodes turn solid.</>,
            <>
              Select the club and add an {b("Invoice")}: 5,000 USDC due in 30
              days. A ghost invoice appears.
            </>,
            <>
              The club approves it with two signers against its Events budget
              and escrows 5,000 USDC. The invoice turns solid.
            </>,
            <>
              Select the invoice and add the {b("Funding pool")}. You receive
              4,000 USDC at once (80%), and the invoice reroutes to the pool.
            </>,
            <>
              In the Timeline, use {b("Jump to due date")}. The club pays at
              maturity in one transaction: the pool keeps its advance plus the
              fee, and the reserve runs through your Split.
            </>,
            <>The Timeline lists the whole journey, proposal to settlement.</>,
          ]}
        />
      </Section>

      <Section title="Sandbox demo: you are the buyer, and an LP">
        <Steps
          items={[
            <>
              The {b("demo print shop")} has proposed to sell to you. Open it
              from the Inbox and accept. It issues a 1,200 USDC invoice.
            </>,
            <>
              Add a {b("Budget")} (Spend control). Then add {b("Approval")} and
              require 2 signatures above 500 USDC. Your second member is the{" "}
              {b("sandbox co-signer")}.
            </>,
            <>
              Drag the Budget onto the print shop&apos;s invoice and approve.
              The operation waits at the Approval node with 1 of 2. Use{" "}
              {b("Ask co-signer to sign")}.
            </>,
            <>
              Select the approved invoice and add {b("Escrow")}. The co-signer
              signs again.
            </>,
            <>
              Add {b("Schedule")} to the invoice and pick a time, at least 1
              minute ahead. The co-signer signs, then jump past that time. The
              keeper runs it on-chain. Anyone can press {b("Run now")} on a due
              schedule. On the Account or a counterparty, Schedule repeats a
              transfer every minute, hour or day.
            </>,
            <>
              Add {b("Pool liquidity")} (Financing) and deposit from your
              wallet. Withdraw again from the Funding pool node.
            </>,
          ]}
        />
      </Section>

      <Section title="What the labels mean">
        <div className="flex flex-wrap gap-2">
          <Chip color="warning" size="sm" variant="soft">
            Sandbox
          </Chip>
          <Chip size="sm" variant="tertiary">
            testnet zUSDC
          </Chip>
          <Chip color="warning" size="sm" variant="soft">
            simulated yield
          </Chip>
        </div>
        <p className="text-muted">
          Every amount the sandbox seeds (balances, budgets, the club&apos;s
          credit line, the print shop&apos;s invoices, the 500 USDC approval
          limit) is a sandbox value, not a calibration. zUSDC is test money.
          Vault yield is simulated. Stream is not supported by the v1 contracts.
        </p>
        <p className="text-muted">
          The sandbox clock moves only forward. +1 day and +30 days jump it;
          Reset starts over with a fresh seed.
        </p>
      </Section>
    </div>
  );
}
