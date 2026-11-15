"use client";

import { NotificationsProvider } from "./notifications";
import { Sidebar } from "./sidebar";

import { useCanvasView } from "@/hooks/use-canvas-view";
import { useLiveUpdates } from "@/hooks/use-live-updates";
import { SelectedAccountProvider } from "@/hooks/use-selected-account";

/**
 * Sidebar plus page, on the canvas `?account=` selects. Live updates are wired here, so every page of the app
 * stays live (PRD principle 5) and follows the selected canvas.
 */
export function AppShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <SelectedAccountProvider>
      <Shell>{children}</Shell>
    </SelectedAccountProvider>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  const { network, canvas } = useCanvasView();

  useLiveUpdates(network, canvas.data?.account.address);

  return (
    <NotificationsProvider>
      <div className="flex h-screen w-full overflow-hidden">
        <Sidebar />
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </NotificationsProvider>
  );
}
