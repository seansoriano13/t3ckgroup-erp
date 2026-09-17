import { describe, it, expect } from "vitest"
import { chooseTestRun } from "../../../scripts/lib/testSelection.mjs"

// Preflight runs only the tests a change can reach, because CI runs the whole
// suite on every push anyway. The danger is the other direction: a change the
// import graph cannot see (a migration read off disk by the fake schema, the
// harness every test shares) must never be waved through on a scoped run.

const BASE = "3f2a9c1"

describe("chooseTestRun", () => {
  it("scopes the run to the change when only application source moved", () => {
    const run = chooseTestRun({
      changedFiles: ["src/components/sor/modal/NowTab.jsx", "src/services/opportunityService.js"],
      base: BASE,
    })

    expect(run.mode).toBe("changed")
    expect(run.command).toBe(`vitest run --changed ${BASE} --passWithNoTests`)
  })

  it("runs everything when a migration changed, since the fake schema reads SQL off disk", () => {
    const run = chooseTestRun({
      changedFiles: ["src/services/opportunityService.js", "supabase/migrations/20260928000000_sor_participant_modal_fields.sql"],
      base: BASE,
    })

    expect(run.mode).toBe("full")
    expect(run.command).toBe("vitest run")
    expect(run.reason).toMatch(/supabase\/migrations\/20260928000000_sor_participant_modal_fields\.sql/)
  })

  it.each(["src/test/setup.harness.js", "src/test/db/store.js", "src/test/msw/postgrest.js", "src/test/support.jsx"])(
    "runs everything when shared test infrastructure (%s) changed",
    (file) => {
      const run = chooseTestRun({ changedFiles: [file], base: BASE })

      expect(run.mode).toBe("full")
      expect(run.reason).toContain(file)
    },
  )

  it.each(["vitest.config.js", "vitest.db.config.js", "package.json", "pnpm-lock.yaml"])(
    "runs everything when %s changed, since it shapes every test's environment",
    (file) => {
      const run = chooseTestRun({ changedFiles: ["src/utils/commission.js", file], base: BASE })

      expect(run.mode).toBe("full")
      expect(run.reason).toContain(file)
    },
  )

  it("runs everything when asked to with --full, whatever changed", () => {
    const run = chooseTestRun({ changedFiles: ["src/utils/commission.js"], base: BASE, full: true })

    expect(run.mode).toBe("full")
    expect(run.reason).toMatch(/--full/)
  })

  it("runs everything when there is no merge base, rather than scoping to nothing", () => {
    const run = chooseTestRun({ changedFiles: ["src/utils/commission.js"], base: "" })

    expect(run.mode).toBe("full")
    expect(run.reason).toMatch(/origin\/staging/)
  })

  it("lets a change that reaches no test pass, so a docs-only push is not blocked", () => {
    const run = chooseTestRun({ changedFiles: ["docs/testing.md", "CONTEXT.md"], base: BASE })

    expect(run.mode).toBe("changed")
    expect(run.command).toContain("--passWithNoTests")
  })

  it("keeps the run scoped when the change is a test file itself", () => {
    const run = chooseTestRun({
      changedFiles: ["src/test/pages/offsets.test.jsx", "src/components/sor/modal/SorModalAccessLevel.test.jsx"],
      base: BASE,
    })

    expect(run.mode).toBe("changed")
  })
})
