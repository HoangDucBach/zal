import { ExplorerToken } from "@/components/explorer/token";

export const metadata = { title: "Token · Explorer" };

export default async function ExplorerTokenPage({
  params,
}: {
  readonly params: Promise<{ readonly address: string }>;
}) {
  const { address } = await params;

  return <ExplorerToken param={address} />;
}
