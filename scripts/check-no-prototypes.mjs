#!/usr/bin/env node
// REMOVE-BEFORE-PROD gate (ADR 0028). The SOR modal layout prototype lives in
// the tree, build-gated: staging/local builds load it through a dynamic
// import(), a production build must contain none of it. This check proves it:
// it runs a production `vite build` and fails if the output has a prototype
// marker. It also fails on staging once the sunset date passes while the
// prototype folder still exists, so the prototype gets deleted or the date
// bumped on purpose.
//
//   node scripts/check-no-prototypes.mjs              # bundle check
//   node scripts/check-no-prototypes.mjs --staging    # + sunset check (CI on the staging branch)
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PROTOTYPE_DIR = "src/components/sor/modal/prototype"
const SUNSET = "2026-12-31" // bump on purpose, or delete the prototype
// Strings that survive minification and only exist inside the prototype.
const MARKERS = ["sor-modal-layout-v2", "sor-modal-layout-change"]

const problems = []

const isStaging = process.argv.includes("--staging")
if (isStaging && existsSync(PROTOTYPE_DIR)) {
  const today = new Date().toISOString().slice(0, 10)
  if (today > SUNSET) {
    problems.push(`${PROTOTYPE_DIR} is past its sunset (${SUNSET}): delete it, or bump SUNSET in this script on purpose`)
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
}

const out = mkdtempSync(join(tmpdir(), "prod-bundle-"))
try {
  execSync(`pnpm exec vite build --outDir "${out}" --emptyOutDir --logLevel error`, {
    stdio: "inherit",
    env: { ...process.env, VITE_APP_ENV: "production" },
  })
  for (const file of walk(out).filter((f) => /\.(js|css|html)$/.test(f))) {
    const text = readFileSync(file, "utf8")
    for (const m of MARKERS) if (text.includes(m)) problems.push(`prod bundle ${file.slice(out.length + 1)} contains prototype marker "${m}"`)
  }
} finally {
  rmSync(out, { recursive: true, force: true })
}

if (problems.length) {
  console.error("Prototype gate failed:\n")
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log("Prod bundle has no prototype code.")
