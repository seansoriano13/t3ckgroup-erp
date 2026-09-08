import { defineConfig } from "vitest/config"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The policy tier (Seam A). Unlike the other three tiers, these tests talk to
// a real Postgres — the local Supabase stack — because the two things they
// exist to prove are invisible to the fake database:
//
//   * RLS policies. `src/test/db/schema.js` truncates every SQL source at its
//     first `-- Functions` marker, so the fake has never read a policy.
//   * plpgsql functions. `src/test/msw/postgrest.js` answers `rpc()` from a
//     stub map, so the stored procedures never execute.
//
// Consequence: the rest of the suite passes whether a policy is correct or
// catastrophic, and whether the function that moves an employee's leave
// balance moves it correctly or not. This tier is the only place either can
// fail. See docs/testing.md.
//
// It is deliberately NOT part of `pnpm test` — it needs the stack running.
export default defineConfig({
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    test: {
        // No jsdom: nothing here renders. A Supabase client and a pg pool.
        environment: "node",
        globals: true,
        include: ["src/test/policy/**/*.test.js"],
        globalSetup: ["./src/test/policy/support/global-setup.js"],
        // Every file shares one database, so they must not run concurrently —
        // two files seeding opportunities at once would read each other's rows
        // and the refusals (the assertions that matter) would pass for the
        // wrong reason.
        pool: "forks",
        poolOptions: { forks: { singleFork: true } },
        fileParallelism: false,
        // Filenames are numbered so the fixture assertions run first: a broken
        // cast should fail as a broken cast, not as forty confusing permission
        // failures.
        sequence: { shuffle: false },
        // Real network round trips to Postgres and GoTrue, plus a sign-in per
        // cast member during setup.
        testTimeout: 30_000,
        hookTimeout: 120_000,
        // The company and its data live in Asia/Manila, and the leave rules
        // are local-date based.
        env: { TZ: "Asia/Manila" },
        // No mock-reset options: nothing in this tier is mocked. The whole
        // point is that it talks to the real thing.
    },
})
