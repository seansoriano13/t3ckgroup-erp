import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "./msw/server"
import { resetExternalStubs, resetStorageStubs, resetStubs } from "./msw/server"
import { db } from "./db/store"
import { resetFactories } from "./factories"
import { waitForNetworkIdle } from "./network"
import { stubActionRunRpcs } from "./stubs/actionRunRpc"

/**
 * Realtime is a WebSocket, not HTTP, so MSW cannot intercept it. Subscriptions
 * are stubbed to a socket that never opens: components that call
 * `supabase.channel(...).subscribe()` mount cleanly instead of retrying against
 * a host that does not exist.
 */
class InertWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor(url) {
    this.url = url
    this.readyState = InertWebSocket.CONNECTING
  }
  send() {}
  close() {
    this.readyState = InertWebSocket.CLOSED
  }
  addEventListener() {}
  removeEventListener() {}
}

beforeAll(() => {
  vi.stubGlobal("WebSocket", InertWebSocket)
  // jsdom does not implement scrollIntoView; components that call it to keep
  // a selected row in view would otherwise crash every test that renders them.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  // jsdom has no ResizeObserver. React Flow constructs one the moment it
  // mounts, so every test that renders the Flow Canvas — or any screen that
  // embeds it — throws before its first assertion without this.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  // jsdom has no matchMedia. Defaults every query to non-matching so a
  // width-gated layout (the SOR modal's chat-as-tab switch) renders its wide
  // form in tests unless a test stubs window.matchMedia itself.
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  }
  // Anything not described by a handler is a bug in the test, not something to
  // quietly let through to the real internet.
  server.listen({ onUnhandledRequest: "error" })
})

afterEach(async () => {
  cleanup()
  // Drain fire-and-forget writes before wiping the store, so a notification
  // dispatched by this test cannot land in the next one's database.
  await waitForNetworkIdle()
  server.resetHandlers()
  db.reset()
  resetFactories()
  resetStubs()
  resetExternalStubs()
  resetStorageStubs()
  localStorage.clear()
})

// Issue #204 Part 2 — sor_action_runs' RPCs (sor_begin_action_run,
// sor_finish_action_run, sor_decide_action_run) live in Postgres, which the
// fake database does not execute. Registered globally before every test so
// any test that exercises moveAlongFlow gets real fire-once behavior
// without opting in — a test that needs different behavior can still
// override with its own stubRpc call after this runs.
beforeEach(() => {
  stubActionRunRpcs()
})

afterAll(() => {
  server.close()
})
