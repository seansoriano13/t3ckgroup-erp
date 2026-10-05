import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest"
import { server } from "./msw/server"
import { resetExternalStubs, resetStorageStubs, resetStubs } from "./msw/server"
import { db } from "./db/store"
import { resetFactories } from "./factories"
import { waitForNetworkIdle } from "./network"
import { stubActionRunRpcs } from "./stubs/actionRunRpc"
import { stubCertifyConditionRpc } from "./stubs/certifyConditionRpc"
import { stubMoveOpportunitiesToSnapshotRpc } from "./stubs/moveOpportunitiesToSnapshotRpc"
import { stubReplaceItemsRpc } from "./stubs/replaceItemsRpc"
import { stubResumeStageWorkRpc } from "./stubs/resumeStageWorkRpc"
import { stubStartFreshStageWorkRpc } from "./stubs/startFreshStageWorkRpc"

/**
 * The fake Supabase: MSW answering PostgREST, Storage and Edge Functions from
 * the in-memory database, reset between tests. Used by the services and
 * screens projects (see vitest.config.js).
 *
 * The services project runs in plain Node, so nothing here may assume a DOM.
 * DOM shims and Testing Library cleanup live in setup.dom.js.
 */

/**
 * Realtime is a WebSocket, not HTTP, so MSW cannot intercept it. Subscriptions
 * are stubbed to a socket that never opens: code that calls
 * `supabase.channel(...).subscribe()` runs cleanly instead of retrying against
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
  // Anything not described by a handler is a bug in the test, not something to
  // quietly let through to the real internet.
  server.listen({ onUnhandledRequest: "error" })
})

// Registered before setup.dom.js's afterEach, so under Vitest's default
// "stack" hook order it runs after it: the screen is unmounted before the
// network is drained and the store wiped.
afterEach(async () => {
  // Drain fire-and-forget writes before wiping the store, so a notification
  // dispatched by this test cannot land in the next one's database.
  await waitForNetworkIdle()
  server.resetHandlers()
  db.reset()
  resetFactories()
  resetStubs()
  resetExternalStubs()
  resetStorageStubs()
  // The Supabase session store lives here when the environment provides one
  // (the jsdom environment does; plain Node does not).
  globalThis.localStorage?.clear()
})

// Issue #204 Part 2 — sor_action_runs' RPCs (sor_begin_action_run,
// sor_finish_action_run, sor_decide_action_run) live in Postgres, which the
// fake database does not execute. Registered globally before every test so
// any test that exercises moveAlongFlow gets real fire-once behavior
// without opting in — a test that needs different behavior can still
// override with its own stubRpc call after this runs.
beforeEach(() => {
  stubActionRunRpcs()
  stubCertifyConditionRpc()
  stubReplaceItemsRpc()
  stubMoveOpportunitiesToSnapshotRpc()
  stubResumeStageWorkRpc()
  stubStartFreshStageWorkRpc()
})

afterAll(() => {
  server.close()
})
