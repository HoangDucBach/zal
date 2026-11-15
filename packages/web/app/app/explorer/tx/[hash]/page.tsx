import { ExplorerTx } from "@/components/explorer/tx";

export const metadata = { title: "Transaction · Explorer" };

export default async function ExplorerTxPage({
  params,
}: {
  readonly params: Promise<{ readonly hash: string }>;
}) {
  const { hash } = await params;

  return <ExplorerTx key={hash} hash={hash.toLowerCase()} />;
}
