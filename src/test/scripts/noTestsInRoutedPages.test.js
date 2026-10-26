import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect } from "vitest"

// Generouted turns every .jsx/.tsx/.mdx under src/pages into a route and
// imports it eagerly, except files inside a folder that starts with "_". A test
// file left in a routed spot is therefore bundled into the main chunk, and its
// `import "vitest"` throws while the bundle loads — before React mounts, so no
// error boundary can catch it and a reload cannot recover. Staging went fully
// blank this way (src/pages/calendar/index.test.jsx). Page tests belong in
// src/test/pages; see docs/testing.md.

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const PAGES = path.join(REPO_ROOT, "src/pages")

// Mirrors the glob compiled into @generouted/react-router: names starting with
// a letter, digit, "[" or "-", extension jsx/tsx/mdx, and not under "_*/".
function routedFiles() {
  return fs
    .globSync("**/*.{jsx,tsx,mdx}", { cwd: PAGES })
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => !f.split("/").slice(0, -1).some((dir) => dir.startsWith("_")))
    .filter((f) => /^[A-Za-z0-9[-]/.test(path.basename(f)))
}

const TEST_NAME = /\.(test|spec)\.[jt]sx?$/
const TEST_IMPORT = /from\s+["'](vitest|@testing-library\/[^"']+|msw[^"']*)["']|\bvi\.(mock|fn|spyOn)\(/

describe("files Generouted routes", () => {
  it("includes no test files (they would be bundled into the app and crash it on load)", () => {
    const offenders = routedFiles().filter((f) => TEST_NAME.test(f))
    expect(offenders).toEqual([])
  })

  it("imports no test tooling (vitest, testing-library, msw)", () => {
    const offenders = routedFiles().filter((f) =>
      TEST_IMPORT.test(fs.readFileSync(path.join(PAGES, f), "utf8")),
    )
    expect(offenders).toEqual([])
  })
})
