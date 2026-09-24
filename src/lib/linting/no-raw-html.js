/**
 * Bans raw covered HTML outside the shared UI folder (ADR 0025).
 *
 * Covered: button, input, textarea, select, label, table, img, a, and
 * hand-rolled full-screen modals (`fixed inset-0`). `form`, layout tags,
 * paragraphs and headings are not covered. The only exemption is the shared UI
 * folder, matched by path. The rule also refuses eslint-disable for itself.
 */

export const CATALOG = 'DESIGN.md#primitive-catalog'

const CATALOG_URL = (anchor) => `DESIGN.md#${anchor}`

// element -> [messageId, Primitive to use, catalog heading anchor]
const REPLACEMENTS = {
  button: ['button', 'Button (ui/button.jsx)', 'button'],
  textarea: ['textarea', 'Textarea (ui/textarea.jsx)', 'textarea'],
  select: ['select', 'SelectField (ui/SelectField.jsx)', 'selectfield'],
  label: ['label', 'FieldBox (FieldBox.jsx)', 'fieldbox'],
  table: ['table', 'the Table Primitive set (not built yet: stop and ask the maintainer)', 'primitive-catalog'],
  img: ['img', 'Avatar (people) or ImageAttachment (uploads)', 'avatar'],
  a: ['a', 'the router Link (internal) or ExternalLink (external, not built yet: stop and ask the maintainer)', 'primitive-catalog'],
}

const INPUT_REPLACEMENTS = {
  checkbox: ['inputCheckbox', 'Checkbox (ui/checkbox.jsx)', 'checkbox'],
  file: ['inputFile', 'FileInput (ui/FileInput.jsx)', 'fileinput'],
  default: ['input', 'Input (ui/input.jsx)', 'input'],
}

const MODAL = ['modal', 'Dialog (ui/dialog.jsx)', 'dialog']

const RULE_NAME = 'no-raw-html'
const RULE_IDS = new Set([RULE_NAME, `local/${RULE_NAME}`])

const messages = {}
for (const [id, primitive, anchor] of [
  ...Object.values(REPLACEMENTS),
  ...Object.values(INPUT_REPLACEMENTS),
  MODAL,
]) {
  const what = id === 'modal' ? 'A hand-rolled full-screen modal' : `Raw <${rawTag(id)}>`
  messages[id] =
    `${what} is not allowed outside src/components/ui/. Use ${primitive}. ` +
    `See ${CATALOG_URL(anchor)}. If no Primitive fits, stop and ask the maintainer.`
}
const DISABLE_MESSAGE =
  'eslint-disable of local/no-raw-html is not allowed in feature code. ' +
  `If no Primitive fits, stop and ask the maintainer. See ${CATALOG}.`

function rawTag(id) {
  if (id === 'inputCheckbox' || id === 'inputFile') return 'input type="' + (id === 'inputFile' ? 'file' : 'checkbox') + '"'
  return id
}

export function isExempt(filePath) {
  return filePath.replaceAll('\\', '/').includes('src/components/ui/')
}

function staticString(valueNode) {
  if (!valueNode) return null
  if (valueNode.type === 'Literal' && typeof valueNode.value === 'string') return valueNode.value
  if (valueNode.type === 'JSXExpressionContainer') {
    const e = valueNode.expression
    if (e.type === 'Literal' && typeof e.value === 'string') return e.value
    if (e.type === 'TemplateLiteral' && e.expressions.length === 0) return e.quasis[0].value.cooked
  }
  return null
}

function classText(valueNode) {
  const plain = staticString(valueNode)
  if (plain !== null) return plain
  if (valueNode?.type === 'JSXExpressionContainer' && valueNode.expression.type === 'TemplateLiteral') {
    return valueNode.expression.quasis.map((q) => q.value.raw).join(' ')
  }
  return ''
}

function attr(node, name) {
  return node.attributes.find((a) => a.type === 'JSXAttribute' && a.name.name === name)
}

function isFullScreenModal(node) {
  const tokens = classText(attr(node, 'className')?.value).split(/\s+/)
  return tokens.includes('fixed') && tokens.includes('inset-0')
}

const DIRECTIVE = /(?:\/\/|\/\*)\s*eslint-disable(?:-next-line|-line)?\b([^\n]*)/g

function refusedDirectiveLine(text) {
  for (const m of text.matchAll(DIRECTIVE)) {
    const list = m[1].replace(/\*\/.*$/, '').split('--')[0].trim()
    const names = list ? list.split(',').map((r) => r.trim()) : []
    if (names.length === 0 || names.some((r) => RULE_IDS.has(r))) {
      return text.slice(0, m.index).split('\n').length
    }
  }
  return null
}

// A disable directive filters the rule's own report, so the refusal cannot be a
// rule report. A processor's postprocess runs after directives are applied.
const sourceByFile = new Map()
export const refuseDisableProcessor = {
  meta: { name: 'no-raw-html-refuse-disable' },
  preprocess(text, filename) {
    sourceByFile.set(filename, text)
    return [text]
  },
  postprocess(messageLists, filename) {
    const text = sourceByFile.get(filename) ?? ''
    sourceByFile.delete(filename)
    const messages = messageLists.flat()
    const line = isExempt(filename) ? null : refusedDirectiveLine(text)
    if (line !== null) {
      messages.push({ ruleId: null, severity: 2, message: DISABLE_MESSAGE, line, column: 1 })
    }
    return messages
  },
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow raw covered HTML outside the shared UI folder; use a Primitive.',
      url: 'docs/adr/0025-one-primitive-system-enforced-by-lint.md',
    },
    messages,
    schema: [],
  },
  create(context) {
    const filename = context.filename || context.getFilename()
    if (isExempt(filename)) return {}

    return {
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return
        const tag = node.name.name
        let entry
        if (tag === 'input') {
          const type = staticString(attr(node, 'type')?.value)
          entry = INPUT_REPLACEMENTS[type] ?? INPUT_REPLACEMENTS.default
        } else if (Object.hasOwn(REPLACEMENTS, tag)) {
          entry = REPLACEMENTS[tag]
        } else if (/^[a-z]/.test(tag) && isFullScreenModal(node)) {
          entry = MODAL
        }
        if (entry) context.report({ node, messageId: entry[0] })
      },
    }
  },
}
