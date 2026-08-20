import "@testing-library/jest-dom/vitest"
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "./msw/server"
import { resetExternalStubs, resetStubs } from "./msw/server"
import { db } from "./db/store"
import { resetFactories } from "./factories"
import { waitForNetworkIdle } from "./network"

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
})

afterAll(() => {
  server.close()
})
