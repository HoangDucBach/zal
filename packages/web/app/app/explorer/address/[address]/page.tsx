import { ExplorerAddress } from "@/components/explorer/address";

export const metadata = { title: "Address · Explorer" };

export default async function ExplorerAddressPage({
  params,
}: {
  readonly params: Promise<{ readonly address: string }>;
}) {
  const { address } = await params;

  return <ExplorerAddress param={address} />;
}
