import { useState } from "react"
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import toast from "react-hot-toast"

export const SAMPLE_SAVE_BLOCKED = "This is sample data. Nothing here is saved."

/**
 * A query cache of its own, pre-filled with Sample Data, for the real
 * components Release Notes shows (ADR 0030). A component that asks for a key
 * seeded here gets the sample and never reaches the network.
 *
 * Three locks keep it off the database, because every employee opens this
 * page on prod:
 * - Queries are off by default, so a key nobody seeded does not fetch. A
 *   component that turns its own query on explicitly is caught by the
 *   release-notes test, which fails on any request.
 * - Every mutation is refused before its request is built.
 * - Every form submit inside it — pop-ups included, since React events
 *   bubble through portals — is stopped before the form's own handler runs.
 *
 * `seed` is a list of [queryKey, data] pairs, read once.
 */
export default function SampleProvider({ seed = [], children }) {
  const [client] = useState(() => {
    const created = new QueryClient({
      mutationCache: new MutationCache({
        onMutate: () => {
          throw new Error(SAMPLE_SAVE_BLOCKED)
        },
      }),
      defaultOptions: {
        queries: {
          enabled: false,
          staleTime: Infinity,
          gcTime: Infinity,
          retry: false,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
        mutations: { retry: false },
      },
    })
    for (const [key, data] of seed) created.setQueryData(key, data)
    return created
  })

  return (
    <QueryClientProvider client={client}>
      <div
        onSubmitCapture={(event) => {
          event.preventDefault()
          event.stopPropagation()
          toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })
        }}
      >
        {children}
      </div>
    </QueryClientProvider>
  )
}

/**
 * Looks, but does not write: every input and button inside is disabled.
 * It cannot reach a pop-up's portal; SampleProvider's locks cover those.
 */
export function ReadOnly({ children }) {
  return <fieldset disabled className="m-0 min-w-0 border-0 p-0">{children}</fieldset>
}
