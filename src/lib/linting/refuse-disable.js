/**
 * A processor that refuses eslint-disable for the local rules that guard the
 * design system (no-raw-html, ADR 0025; require-page-shell, ADR 0029).
 *
 * A disable directive filters the rule's own report, so the refusal cannot be a
 * rule report. A processor's postprocess runs after directives are applied.
 */

/** The guard rules. Their findings, and refusals of their disables, fail the gate. */
export const GUARDED_RULES = ['local/no-raw-html', 'local/require-page-shell']

/** True for a lint message the Primitive / PageShell gate reports. */
export const isGuardFinding = (m) =>
  GUARDED_RULES.some((rule) => m.ruleId === rule || m.message.startsWith(`eslint-disable of ${rule}`))

const DIRECTIVE = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b([^\n]*)/g
// `/* eslint local/x: "off" */` reconfigures a rule inline, which switches it off
// just as well as a disable does.
const INLINE_CONFIG = /\/\*\s*eslint\s+([\s\S]*?)\*\//g

const lineOf = (text, index) => text.slice(0, index).split('\n').length

/** Line of the first directive that disables or reconfigures `rule`, or null. */
function refusedDirectiveLine(text, rule) {
  const ids = new Set([rule, `local/${rule}`])
  for (const m of text.matchAll(DIRECTIVE)) {
    const list = m[1].replace(/\*\/.*$/, '').split('--')[0].trim()
    const names = list ? list.split(',').map((r) => r.trim()) : []
    if (names.length === 0 || names.some((r) => ids.has(r))) return lineOf(text, m.index)
  }
  for (const m of text.matchAll(INLINE_CONFIG)) {
    const names = [...m[1].matchAll(/["']?([\w@/-]+)["']?\s*:/g)].map(([, name]) => name)
    if (names.some((r) => ids.has(r))) return lineOf(text, m.index)
  }
  return null
}

/**
 * `guards` maps a local rule name to the message reported when a directive
 * disables it. Files for which `isExempt(filename)` holds are left alone.
 */
export function createRefuseDisableProcessor(guards, isExempt) {
  const sourceByFile = new Map()
  return {
    meta: { name: 'local-refuse-disable' },
    preprocess(text, filename) {
      sourceByFile.set(filename, text)
      return [text]
    },
    postprocess(messageLists, filename) {
      const text = sourceByFile.get(filename) ?? ''
      sourceByFile.delete(filename)
      const messages = messageLists.flat()
      if (isExempt(filename)) return messages
      for (const [rule, message] of Object.entries(guards)) {
        const line = refusedDirectiveLine(text, rule)
        if (line !== null) messages.push({ ruleId: null, severity: 2, message, line, column: 1 })
      }
      return messages
    },
  }
}
