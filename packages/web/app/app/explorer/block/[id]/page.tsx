import { ExplorerBlock } from "@/components/explorer/block";

export const metadata = { title: "Block · Explorer" };

export default async function ExplorerBlockPage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return <ExplorerBlock key={id} id={id} />;
}
