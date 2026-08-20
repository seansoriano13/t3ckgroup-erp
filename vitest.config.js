import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react-swc"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Deliberately does NOT load the Generouted plugin from vite.config.js: it
// scans src/pages to codegen a virtual route module that only main.jsx imports,
// and running it on every test boot is pure cost.
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "./src/test/env/jsdom-node-fetch.js",
        globals: true,
        setupFiles: ["./src/test/setup.js"],
        // The company and its data live in Asia/Manila. Date handling in this
        // app is local-time based, so tests must run in that zone or they
        // assert different behaviour than production sees.
        env: { TZ: "Asia/Manila" },
        include: ["src/**/*.test.{js,jsx}"],
        // The suite is read as three tiers, and each can be run on its own:
        //
        //   pnpm test:unit         isolated functions and hooks, no I/O
        //   pnpm test:integration  a component or service against the fake DB
        //   pnpm test:e2e          a whole page, mounted, driven as a user
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
