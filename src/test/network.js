/**
 * Tracks in-flight requests so a test can wait for the work it started to
 * actually finish.
 *
 * Several services deliberately fire and forget — a notification broadcast or
 * an audit-log write must never block or fail the mutation that produced it.
 * That means the request is still in flight when the service call resolves. If
 * a test ends there, the write lands in the *next* test's database and the
 * suite goes flaky in a way that looks like a service bug.
 *
 * `waitForNetworkIdle()` closes that gap: use it before asserting on anything a
 * service dispatched without awaiting, and the teardown in setup.js calls it
 * before resetting so nothing leaks across the boundary either.
 */

import { server } from "./msw/server"

let inFlight = 0

server.events.on("request:start", () => {
  inFlight += 1
})
server.events.on("request:end", () => {
  inFlight -= 1
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Resolves once no request has been outstanding for a few consecutive turns of
 * the event loop. Several quiet turns rather than one, because a chained
 * follow-up request (read the employees, then insert the notifications) is
 * issued a microtask after the previous response settles.
 */
export async function waitForNetworkIdle({ quietTurns = 3, maxTurns = 200 } = {}) {
  let quiet = 0
  for (let turn = 0; turn < maxTurns && quiet < quietTurns; turn += 1) {
    await tick()
    quiet = inFlight === 0 ? quiet + 1 : 0
  }
  if (inFlight !== 0) {
    throw new Error(`Gave up waiting for the network to settle: ${inFlight} request(s) still open`)
  }
}

export const pendingRequestCount = () => inFlight
