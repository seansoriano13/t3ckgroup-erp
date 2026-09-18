/**
 * Decides which Vitest run `pnpm preflight` makes for a branch.
 *
 * CI runs the full suite on every push, so preflight only needs the tests a
 * change can reach. Vitest's `--changed` finds those through the import graph.
 */

/** Changes that reach tests without an import Vitest can follow. */
const FULL_RUN_TRIGGERS = [
  // src/test/db/schema.js builds the fake database from these with fs.
  { matches: (f) => f.startsWith("supabase/migrations/"), why: "a migration" },
  // The harness, fake DB, MSW handlers and stubs sit under every test, some of
  // them wired in by config rather than imported. A test file here is not one.
  {
    matches: (f) => f.startsWith("src/test/") && !isTestFile(f),
    why: "shared test infrastructure",
  },
  { matches: (f) => /^vitest\..*config\.[cm]?js$/.test(f), why: "a Vitest config" },
  { matches: (f) => f === "package.json" || f === "pnpm-lock.yaml", why: "the dependency set" },
];

function isTestFile(file) {
  return /\.test\.[jt]sx?$/.test(file);
}

const fullRun = (reason) => ({ mode: "full", command: "vitest run", reason });

/**
 * @param {object} args
 * @param {string[]} args.changedFiles repo-relative paths, forward slashes
 * @param {string} args.base merge base with origin/staging; "" when none was found
 * @param {boolean} [args.full] preflight was given --full
 * @returns {{mode: "full"|"changed", command: string, reason?: string}}
 */
export function chooseTestRun({ changedFiles, base, full = false }) {
  if (full) return fullRun("asked for with --full");
  if (!base) return fullRun("no merge base with origin/staging to scope against");

  for (const file of changedFiles) {
    const trigger = FULL_RUN_TRIGGERS.find((t) => t.matches(file));
    if (trigger) return fullRun(`${file} is ${trigger.why}`);
  }
  return {
    mode: "changed",
    command: `vitest run --changed ${base} --passWithNoTests`,
  };
}
