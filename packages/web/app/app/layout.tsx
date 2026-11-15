// xyflow's stylesheet belongs to the /app layout rather than the canvas component, so it is on the page before the
// canvas mounts on any path in (fresh load, client navigation, fast refresh). Without it the panels lose their
// absolute positions and stack, and the dot grid disappears.
import "@xyflow/react/dist/style.css";

import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
