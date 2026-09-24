// The Primitive gate (ADR 0025).
//
//   node scripts/lint-primitives.mjs    fail on any raw covered HTML
//
// It looks at this rule alone: the unrelated lint backlog stays non-blocking.
// There is no baseline; every violation fails.
import { spawnSync } from 'node:child_process'

const RULE = 'local/no-raw-html'
const isOurs = (m) => m.ruleId === RULE || m.message.startsWith('eslint-disable of local/no-raw-html')

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
let failed = 0
for (const { filePath, messages } of results) {
  for (const m of messages.filter(isOurs)) {
    failed++
    console.error(`${filePath}:${m.line}:${m.column}  ${m.message}`)
  }
}
if (failed) {
  console.error(`\n${failed} Primitive violation(s). Use the Primitive, or stop and ask the maintainer. Never eslint-disable.`)
  process.exit(1)
}
console.log('No raw covered HTML.')
