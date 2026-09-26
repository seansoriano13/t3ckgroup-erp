#!/usr/bin/env node
// REMOVE-BEFORE-PROD gate. Staging may carry throwaway UI prototypes; `main`
// (production) may not. CI runs this on every push and PR to `main` and fails
// while any prototype is still in the tree. Remove the prototype and its
// wiring (grep REMOVE-BEFORE-PROD), don't delete this check.
//
//   node scripts/check-no-prototypes.mjs
import { existsSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"

const problems = []

const PROTOTYPE_DIRS = ["src/components/sor/modal/prototype"]
for (const dir of PROTOTYPE_DIRS) {
  if (existsSync(dir)) problems.push(`${dir}/ still exists`)
}

let tagged = ""
try {
  tagged = execSync('git grep -l "REMOVE-BEFORE-PROD" -- src', { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
} catch {
  // git grep exits 1 when nothing matches
}
for (const file of tagged.split("\n").filter(Boolean)) {
  if (!PROTOTYPE_DIRS.some((d) => file.startsWith(d))) problems.push(`${file} is tagged REMOVE-BEFORE-PROD`)
}

// The staging-only changelog entry announcing the layout preview must not
// reach production's "What's New" modal either.
const CHANGELOG = "src/data/changelog.json"
if (existsSync(CHANGELOG) && readFileSync(CHANGELOG, "utf8").includes("SOR Layout Preview (Staging)")) {
  problems.push(`${CHANGELOG} still has the "SOR Layout Preview (Staging)" entry`)
}

if (problems.length) {
  console.error("Prototype code is not allowed on main (production):\n")
  for (const p of problems) console.error(`  - ${p}`)
  console.error("\nRemove the SOR modal layout prototype and every REMOVE-BEFORE-PROD line, then push again.")
  process.exit(1)
}
console.log("No prototypes in the tree.")
