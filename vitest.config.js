import { defineConfig, configDefaults } from "vitest/config"
import react from "@vitejs/plugin-react-swc"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const LOGIC = [
    "src/utils/**/*.test.{js,jsx}",
    "src/constants/**/*.test.{js,jsx}",
    "src/lib/pdf/**/*.test.{js,jsx}",
    "src/test/scripts/**/*.test.{js,jsx}",
]
const SERVICES = [
    "src/services/**/*.test.{js,jsx}",
    "src/test/db/**/*.test.{js,jsx}",
    "src/test/factories.test.js",
]
const EXCLUDE = [...configDefaults.exclude, "src/test/policy/**"]

// Deliberately does NOT load the Generouted plugin from vite.config.js: it
// scans src/pages to codegen a virtual route module that only main.jsx imports,
// and running it on every test boot is pure cost.
export default defineConfig({
    plugins: [react()],
    // Settings' build-fingerprint footer reads these Vite `define` globals;
    // vite.config.js sets them from real build metadata, tests just need
    // them to exist.
    define: {
        __APP_VERSION__: JSON.stringify("test"),
        __APP_SEMVER__: JSON.stringify("test"),
        __BUILD_TIME__: JSON.stringify(new Date(0).toISOString()),
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        globals: true,
        // The company and its data live in Asia/Manila. Date handling in this
        // app is local-time based, so tests must run in that zone or they
        // assert different behaviour than production sees.
        env: { TZ: "Asia/Manila" },
        // Each file runs in the lightest environment it needs. Booting jsdom,
        // MSW and the migration-parsed fake database costs seconds per file,
        // so a pure function test should not pay for it. Membership is by
        // location; src/test/scripts/vitestProjects.test.js fails if a test
        // file lands in no project or in two. A single file that needs a
        // browser global can opt in with a `@vitest-environment` docblock.
        //
        // The policy tier needs a real Postgres, so it is in no project — a
        // colleague without the local stack up would otherwise see failures
        // that say nothing about their change. It has its own config and its
        // own command: `pnpm test:db`.
        projects: [
            {
                extends: true,
                test: {
                    name: "logic",
                    // Pure functions and scripts: no DOM, no network, no setup.
                    environment: "node",
                    include: LOGIC,
                    exclude: EXCLUDE,
                },
            },
            {
                extends: true,
                test: {
                    name: "services",
                    // The fake Supabase, in plain Node — nothing here renders.
                    environment: "node",
                    setupFiles: ["./src/test/setup.harness.js"],
                    include: SERVICES,
                    exclude: EXCLUDE,
                },
            },
            {
                extends: true,
                test: {
                    name: "screens",
                    // Everything else renders: components, hooks, pages.
                    environment: "./src/test/env/jsdom-node-fetch.js",
                    setupFiles: ["./src/test/setup.harness.js", "./src/test/setup.dom.js"],
                    include: ["src/**/*.test.{js,jsx}"],
                    exclude: [...EXCLUDE, ...LOGIC, ...SERVICES],
                },
            },
        ],
        // The suite is read as tiers, and each can be run on its own:
        //
        //   pnpm test:unit         isolated functions and hooks, no I/O
        //   pnpm test:integration  a component or service against the fake DB
        //   pnpm test:e2e          a whole page, mounted, driven as a user
        //   pnpm test:db           RLS policies and plpgsql, on a real Postgres
        //                          (excluded below — it has its own config)
        //
        // Membership is by location, not by hand — see the scripts in
        // package.json and the tier table in docs/testing.md.
        // Services talk to a shared in-memory database, so files must not share
        // a worker. Forks give each file its own process and its own store.
        pool: "forks",
        restoreMocks: true,
        clearMocks: true,
        unstubEnvs: true,
        unstubGlobals: true,
        coverage: {
            provider: "v8",
            reporter: ["text", "html", "lcov"],
            reportsDirectory: "./coverage",
            include: ["src/**/*.{js,jsx}"],
            exclude: [
                "src/test/**",
                "src/**/*.test.{js,jsx}",
                "src/main.jsx",
                "src/components/ui/**",
            ],
        },
    },
})
