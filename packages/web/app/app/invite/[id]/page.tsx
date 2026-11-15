import { InviteView } from "@/components/invite/invite-view";

export const metadata = { title: "Invite" };

export default async function InvitePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return <InviteView id={id} />;
}
