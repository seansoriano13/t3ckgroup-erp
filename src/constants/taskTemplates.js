/**
 * Task title/description templates for Stage Actions (issue #204).
 *
 * Replaces the old fixed `[SO Number] [Project Title]` title
 * (`stageActionTaskTitle` in `salesFlow.js`) and the hardcoded
 * "(Auto-created on entering stage: X for deal: Y)" marker with
 * `{{key}}` tokens an Operations Manager can place anywhere in a
 * group task's or individual task's title/description.
 *
 * `renderTemplate` is pure and a no-op on a string with no tokens, so an
 * existing `config.title`/`config.projectTitle`/`config.description`
 * written before this feature existed still renders literally — no
 * running automation changes shape on upgrade (issue #204 user story 6).
 */

/**
 * Each variable's resolver reads from a "sample SOR" style context object:
 * { salesReference, projectTitle, company, stageName, dealOwnerName, saleType }
 */
export const TEMPLATE_VARIABLES = [
  {
    key: "so_number",
    label: "SO Number",
    resolve: (ctx) => (ctx?.salesReference ? ctx.salesReference : "No SO yet"),
  },
  {
    key: "project_title",
    label: "Project Title",
    resolve: (ctx) => (ctx?.projectTitle ? ctx.projectTitle : "Untitled Project"),
  },
  {
    key: "company",
    label: "Company",
    resolve: (ctx) => ctx?.company || "",
  },
  {
    key: "stage",
    label: "Stage",
    resolve: (ctx) => ctx?.stageName || "",
  },
  {
    key: "deal_owner",
    label: "Deal Owner",
    resolve: (ctx) => ctx?.dealOwnerName || "",
  },
  {
    key: "sale_type",
    label: "Sale Type",
    resolve: (ctx) => ctx?.saleType || "",
  },
]

const TEMPLATE_VARIABLES_BY_KEY = new Map(TEMPLATE_VARIABLES.map((v) => [v.key, v]))

/** A sample SOR to render the live preview against, in the action form. */
export const SAMPLE_TEMPLATE_CONTEXT = {
  salesReference: "S01234",
  projectTitle: "Sample Project",
  company: "Sample Client Co.",
  stageName: "Qualified",
  dealOwnerName: "Dela Cruz, Juan",
  saleType: "Government",
}

/** Today's default title, unchanged from `stageActionTaskTitle`'s shape. */
export const DEFAULT_TITLE_TEMPLATE = "[{{so_number}}] [{{project_title}}]"

const TOKEN_PATTERN = /\{\{\s*([a-z_]+)\s*\}\}/g

/**
 * Replaces every `{{key}}` token in `template` with its resolved value from
 * `context`. A token whose key isn't in `TEMPLATE_VARIABLES` is left exactly
 * as written (unknown tokens are data, not errors). Repeated tokens all
 * resolve. A blank/nullish template renders as `DEFAULT_TITLE_TEMPLATE`.
 */
export function renderTemplate(template, context = {}) {
  const source = template && String(template).trim() ? template : DEFAULT_TITLE_TEMPLATE
  return source.replace(TOKEN_PATTERN, (match, key) => {
    const variable = TEMPLATE_VARIABLES_BY_KEY.get(key)
    if (!variable) return match
    const value = variable.resolve(context)
    return value === null || value === undefined ? "" : String(value)
  })
}

/**
 * `renderTemplate`'s replacement, but as `{ text, isToken }` segments rather
 * than one flat string — so a preview can color exactly the substituted
 * parts, the same violet the source `{{key}}` token wears in the field
 * being typed in, and visually tie the two together.
 */
export function renderTemplateSegments(template, context = {}) {
  const source = template && String(template).trim() ? template : DEFAULT_TITLE_TEMPLATE
  const segments = []
  let lastIndex = 0
  let match
  const re = new RegExp(TOKEN_PATTERN)
  while ((match = re.exec(source))) {
    if (match.index > lastIndex) segments.push({ text: source.slice(lastIndex, match.index), isToken: false })
    const variable = TEMPLATE_VARIABLES_BY_KEY.get(match[1])
    const value = variable ? variable.resolve(context) : match[0]
    segments.push({ text: value === null || value === undefined ? "" : String(value), isToken: Boolean(variable) })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < source.length) segments.push({ text: source.slice(lastIndex), isToken: false })
  return segments
}

/**
 * Splits a raw, unrendered `{{key}}`-bearing string (an action's saved
 * title/description, as seen on the canvas or in a list, never sample-data
 * output) into `{ text, isToken }` segments where a token's `text` is its
 * human label ("SO Number") rather than the literal `{{so_number}}` — same
 * masking `HighlightedTemplateField` shows while typing it, for anywhere
 * else that string is displayed read-only.
 */
export function renderTemplateLabelSegments(text) {
  const source = text || ""
  const segments = []
  let lastIndex = 0
  let match
  const re = new RegExp(TOKEN_PATTERN)
  while ((match = re.exec(source))) {
    if (match.index > lastIndex) segments.push({ text: source.slice(lastIndex, match.index), isToken: false })
    const variable = TEMPLATE_VARIABLES_BY_KEY.get(match[1])
    segments.push({ text: variable?.label || match[1], isToken: Boolean(variable) })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < source.length) segments.push({ text: source.slice(lastIndex), isToken: false })
  return segments
}
