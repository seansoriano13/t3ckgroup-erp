// The app-wide lint backlog gate: errors may go down, never up.
//
//   node scripts/lint-ratchet.mjs            fail if any rule has more errors than the baseline
//   node scripts/lint-ratchet.mjs --update   rewrite the baseline to today's counts
//
// The baseline lives in scripts/lint-baseline.json, one error count per rule.
// A rule that is not in the baseline has a count of 0, so a new kind of error
// fails. Fix errors and run --update to lock the lower count in. The Primitive
// and PageShell rules are stricter (no baseline) and stay in lint-primitives.mjs.
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const baselinePath = fileURLToPath(new URL('./lint-baseline.json', import.meta.url))

const run = spawnSync('pnpm', ['exec', 'eslint', '.', '--format', 'json'], {
  encoding: 'utf8',
  shell: true,
  maxBuffer: 256 * 1024 * 1024,
})
let results
try {
  results = JSON.parse(run.stdout)
} catch {
  console.error(run.stdout || run.stderr)
  process.exit(2)
}

const counts = {}
for (const { messages } of results) {
  for (const m of messages) {
    if (m.severity !== 2) continue
    const rule = m.ruleId ?? 'parse-error'
    counts[rule] = (counts[rule] ?? 0) + 1
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0)

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(baselinePath, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`Baseline written: ${total} errors across ${Object.keys(sorted).length} rules.`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const worse = Object.entries(counts).filter(([rule, n]) => n > (baseline[rule] ?? 0))
const better = Object.entries(baseline).filter(([rule, n]) => (counts[rule] ?? 0) < n)

if (worse.length) {
  for (const [rule, n] of worse) {
    console.error(`${rule}: ${n} errors, baseline allows ${baseline[rule] ?? 0}`)
  }
  console.error('\nLint errors went up. Fix the new ones; do not raise the baseline.')
  process.exit(1)
}
if (better.length) {
  console.log('Fewer errors than the baseline. Run `node scripts/lint-ratchet.mjs --update` and commit it.')
}
console.log(`Lint ratchet holds: ${total} errors, none above the baseline.`)
