import { useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

/**
 * A query cache of its own, pre-filled with sample data, for the deck's real
 * components (ADR 0022). Nothing is stale, so nothing refetches: a component
 * that asks for a key seeded here gets the sample and never reaches the
 * network. `seed` is a list of [queryKey, data] pairs, read once.
 */
export default function SampleProvider({ seed = [], children }) {
  const [client] = useState(() => {
    const created = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      },
    })
    for (const [key, data] of seed) created.setQueryData(key, data)
    return created
  })

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Looks, but does not write. Sample data has no rows behind it, and a
 * Super Admin is looking at it, so anything that would save is switched off.
 */
export function ReadOnly({ children }) {
  return <fieldset disabled className="m-0 min-w-0 border-0 p-0">{children}</fieldset>
}
