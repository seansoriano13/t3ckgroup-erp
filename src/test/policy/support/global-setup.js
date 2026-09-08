/**
 * Runs once, before any test file. Proves the stack is reachable, clears any
 * residue from a previous run, and seeds the cast.
 *
 * Seeding here rather than in a beforeAll means a broken fixture fails the run
 * outright with one message, instead of surfacing as several files' worth of
 * unexplained permission failures.
 */
import { assertStackReachable, closeSql, ensureRealtimeShim } from "./stack.js"
import { seedCast, seedReferenceData, teardownCast } from "./cast.js"

export async function setup() {
    await assertStackReachable()
    await ensureRealtimeShim()
    await teardownCast()
    await seedReferenceData()
    await seedCast()
}

export async function teardown() {
    // Deliberately leaves the seeded cast in place: the next run clears it
    // first, and leaving it means a failed run can be inspected in Studio.
    await closeSql()
}
