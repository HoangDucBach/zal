"use client";

import type { ThemeProviderProps } from "next-themes";

import * as React from "react";
import { RouterProvider, Toast } from "@heroui/react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { WagmiProvider } from "wagmi";

import { wagmiConfig } from "@/config/wagmi";

export interface ProvidersProps {
  children: React.ReactNode;
  themeProps?: ThemeProviderProps;
}

export function Providers({ children, themeProps }: ProvidersProps) {
  const router = useRouter();
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <NextThemesProvider {...themeProps}>
          <RouterProvider navigate={router.push}>
            {children}
            <Toast.Provider placement="bottom end" />
          </RouterProvider>
        </NextThemesProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
