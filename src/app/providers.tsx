"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import ProProvider from "@/components/ProProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import OnboardingCheck from "@/components/OnboardingCheck";
import ClientBrandProvider from "@/components/ClientBrandProvider";
import OneSignalManager from "@/components/OneSignalManager";
import type { ReactNode } from "react";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Prevent automatic refetch on window focus — reduces redundant
        // Supabase calls every time the user tab-switches back.
        refetchOnWindowFocus: false,
        // Cache data for 5 minutes before considering it stale.
        staleTime: 5 * 60 * 1000,
        // Retry once on failure (not the default 3x) to avoid hammering
        // Supabase when rate-limited.
        retry: 1,
      },
    },
  });
}

export default function Providers({ children }: { children: ReactNode }) {
  // QueryClient inside useState so it is created once per client mount and
  // never shared across SSR renders or recreated on re-renders.
  const [queryClient] = useState(() => makeQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <AuthProvider>
          <ClientBrandProvider>
            <ProProvider>
              {children}
              <OnboardingCheck />
              <OneSignalManager />
            </ProProvider>
          </ClientBrandProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
