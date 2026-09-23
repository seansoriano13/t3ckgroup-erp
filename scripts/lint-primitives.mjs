// The Primitive gate (ADR 0025).
//
//   node scripts/lint-primitives.mjs          fail on any new raw covered HTML
//   node scripts/lint-primitives.mjs --count  remaining (frozen) violations per element type
//
// The gate runs the real CLI, so eslint-suppressions.json is applied and only
// violations outside the baseline fail. It looks at this rule alone: the
// unrelated lint backlog stays non-blocking. The count reads the baseline
// through the API, which applies no suppressions, so it sees everything.
import { spawnSync } from 'node:child_process'
import { ESLint } from 'eslint'

const RULE = 'local/no-raw-html'
const isOurs = (m) => m.ruleId === RULE || m.message.startsWith('eslint-disable of local/no-raw-html')

if (process.argv.includes('--count')) {
  const eslint = new ESLint()
  const results = await eslint.lintFiles(['.'])
  const counts = {}
  for (const { messages } of results) {
    for (const m of messages.filter((m) => m.ruleId === RULE)) {
      const kind = m.message.startsWith('A hand-rolled') ? 'modal' : /^Raw <(\w+)/.exec(m.message)[1]
      const key = /type="(\w+)"/.exec(m.message)?.[0] ? `${kind} ${/type="(\w+)"/.exec(m.message)[1]}` : kind
      counts[key] = (counts[key] ?? 0) + 1
    }
  }
  const rows = Object.entries(counts).sort((a, b) => b[1] - a[1])
  for (const [key, n] of rows) console.log(`${String(n).padStart(5)}  ${key}`)
  console.log(`${String(rows.reduce((t, [, n]) => t + n, 0)).padStart(5)}  total`)
  process.exit(0)
}

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
  console.error(`\n${failed} new Primitive violation(s). Use the Primitive, or stop and ask the maintainer. Never eslint-disable.`)
  process.exit(1)
}
console.log('No new raw covered HTML.')
