/**
 * Rendering helpers for hook and component tests.
 *
 * The app wraps everything in a React Query client, so anything that fetches
 * needs one in the tree. The client here is configured for tests: no retries
 * (a failing request should fail the test immediately, not three seconds
 * later) and no caching between tests.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, renderHook } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A failing request should fail the test now, not three retries later.
        retry: false,
        staleTime: 0,
        refetchOnWindowFocus: false,
        // Cache entries must survive the test: an optimistic update writes to a
        // key nothing is subscribed to yet, and a zero gcTime collects it
        // before the assertion can see it. Isolation comes from each test
        // getting its own client, not from eviction.
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  })
}

function Providers({ client, children }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** renderHook with a React Query provider around it. */
export function renderHookWithQuery(hook, { client = createTestQueryClient(), ...options } = {}) {
  return {
    client,
    ...renderHook(hook, {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
      ...options,
    }),
  }
}

/** render with a React Query provider around it. */
export function renderWithProviders(ui, { client = createTestQueryClient(), ...options } = {}) {
  return {
    client,
    ...render(ui, {
      wrapper: ({ children }) => <Providers client={client}>{children}</Providers>,
      ...options,
    }),
  }
}

/**
 * A user-event instance with no pause between actions.
 *
 * user-event's default waits one `setTimeout` after every click and keystroke.
 * On Windows that timer rounds up to ~15 ms, which on its own made an
 * interactive screen test file around a quarter slower. Pass `{ delay: 0 }`
 * (or any other option) when the test is about timing.
 */
export function setupUser(options = {}) {
  return userEvent.setup({ delay: null, ...options })
}
