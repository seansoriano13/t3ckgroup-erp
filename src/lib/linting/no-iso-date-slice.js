// ADR 0039: dates are Manila dates. `toISOString()` reads in UTC, so slicing or
// splitting it into a date gives yesterday between midnight and 8 AM Manila.
// Use src/lib/manilaDate.js instead.
const BANNED_METHODS = new Set(['slice', 'split', 'substring', 'substr'])

export const MESSAGE =
  'Do not cut a date out of toISOString(): it is UTC and shows yesterday before 8 AM in Manila (ADR 0039). Use the helpers in src/lib/manilaDate.js.'

export function isExempt(filename = '') {
  return filename.replace(/\\/g, '/').endsWith('src/lib/manilaDate.js')
}

export default {
  meta: { type: 'problem', schema: [], messages: { banned: MESSAGE } },
  create(context) {
    if (isExempt(context.filename ?? context.getFilename())) return {}
    return {
      CallExpression(node) {
        const callee = node.callee
        if (callee.type !== 'MemberExpression' || callee.computed) return
        if (callee.property.type !== 'Identifier' || !BANNED_METHODS.has(callee.property.name)) return
        const inner = callee.object
        if (
          inner.type === 'CallExpression' &&
          inner.callee.type === 'MemberExpression' &&
          !inner.callee.computed &&
          inner.callee.property.name === 'toISOString'
        ) {
          context.report({ node, messageId: 'banned' })
        }
      },
    }
  },
}
