"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * The query cache of the stay's page, and of nothing else: this is the one screen whose
 * truth arrives later than its render — a payment is confirmed by the provider's webhook,
 * not by the browser that paid, so the page polls the booking until it changes. Held here
 * rather than in the app's providers, so the other screens do not load TanStack Query.
 * The client is made in state rather than at module scope, so a server render never
 * shares one between two visitors.
 */
export const BookingQueryProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};
