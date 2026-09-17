import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"
import { createVitest } from "vitest/node"

// `pnpm test` runs three projects — logic, services, screens — each with only
// the environment its tests need. Membership is by location, so the risk is a
// test file that lands in a directory no project names (it silently never
// runs) or in two (it runs twice, once in the wrong environment). Vitest's own
// globbing is asked, not a copy of the patterns, so this cannot drift from the
// config unnoticed.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const PROJECTS = ["logic", "services", "screens"]

function testFilesOnDisk() {
  return fs
    .globSync("src/**/*.test.{js,jsx}", { cwd: REPO_ROOT })
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => !f.startsWith("src/test/policy/"))
    .sort()
}

async function projectsByFile() {
  const vitest = await createVitest(
    "test",
    { root: REPO_ROOT, watch: false, config: path.join(REPO_ROOT, "vitest.config.js") },
    {},
    { logLevel: "silent" },
  )
  try {
    const specs = await vitest.globTestSpecifications()
    const byFile = new Map()
    for (const spec of specs) {
      const file = path.relative(REPO_ROOT, spec.moduleId).split(path.sep).join("/")
      byFile.set(file, [...(byFile.get(file) ?? []), spec.project.name])
    }
    return byFile
  } finally {
    await vitest.close()
  }
}

describe("vitest projects", () => {
  it("puts every test file in exactly one of logic, services or screens", async () => {
    const byFile = await projectsByFile()

    const misplaced = testFilesOnDisk()
      .map((file) => ({ file, projects: byFile.get(file) ?? [] }))
      .filter(({ projects }) => projects.length !== 1 || !PROJECTS.includes(projects[0]))

    expect(misplaced).toEqual([])
  }, 60_000)

  it("never runs the policy tier, which needs the local Postgres stack", async () => {
    const byFile = await projectsByFile()

    expect([...byFile.keys()].filter((f) => f.startsWith("src/test/policy/"))).toEqual([])
  }, 60_000)
})
