/**
 * Every routed Page renders through PageShell (ADR 0029).
 *
 * A routed Page is a `.jsx`/`.tsx` file under src/pages/ that the router picks
 * up: no path segment starts with `_`. It passes when it renders PageShell, or
 * renders a component imported from a file that renders PageShell (a layout
 * shared by several routes), or renders nothing but `<Navigate>` (a redirect).
 * The screens `src/pages/_app.jsx` renders outside the app frame (login,
 * password reset, verify) are not Pages.
 *
 * PageHeader renders only inside PageShell, so any other file rendering it
 * fails. The shared UI folder is exempt. eslint-disable for this rule is refused
 * by the processor in refuse-disable.js.
 */
import fs from 'node:fs'
import path from 'node:path'
import { isExempt } from './no-raw-html.js'

const DOC = 'DESIGN.md#pageshell'

export const DISABLE_MESSAGE =
  'eslint-disable of local/require-page-shell is not allowed in feature code. ' +
  `If PageShell does not fit, stop and ask the maintainer. See ${DOC}.`

const messages = {
  noShell:
    'A routed Page must render through PageShell (ADR 0029). Wrap it in PageShell, ' +
    `or render a layout that does. See ${DOC}. If PageShell does not fit, stop and ask the maintainer.`,
  header:
    'PageHeader renders only inside PageShell (ADR 0029). Pass title, description ' +
    `and action to PageShell instead. See ${DOC}.`,
}

const PAGES = /(?:^|\/)src\/pages\/(.+)$/
// Mirrors src/pages/_app.jsx, which renders these bare, without the app frame.
const OUTSIDE_APP_FRAME = ['login/', 'reset-password/', 'verify/']

function isRoutedPage(filePath) {
  const route = filePath.replaceAll('\\', '/').match(PAGES)?.[1]
  if (!route || !/\.(jsx|tsx)$/.test(route)) return false
  if (route.split('/').some((segment) => segment.startsWith('_'))) return false
  return !OUTSIDE_APP_FRAME.some((dir) => route.startsWith(dir))
}

const RESOLVE = ['', '.jsx', '.js', '.tsx', '.ts', '/index.jsx', '/index.js', '/index.tsx', '/index.ts']

function resolveImport(source, fromFile, cwd) {
  let base
  if (source.startsWith('@/')) base = path.join(cwd, 'src', source.slice(2))
  else if (source.startsWith('.')) base = path.resolve(path.dirname(fromFile), source)
  else return null
  return RESOLVE.map((ext) => base + ext).find((f) => fs.existsSync(f) && fs.statSync(f).isFile()) ?? null
}

// Keyed by mtime, so a long-lived ESLint (the editor's) sees a layout change.
const shellByFile = new Map()
function rendersPageShell(file) {
  const mtime = fs.statSync(file).mtimeMs
  const cached = shellByFile.get(file)
  if (cached?.mtime === mtime) return cached.renders
  const text = fs.readFileSync(file, 'utf8')
  const renders = /\bimport\s+PageShell\b/.test(text) && /<PageShell\b/.test(text)
  shellByFile.set(file, { mtime, renders })
  return renders
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require every routed Page to render through PageShell, and PageHeader only inside it.',
      url: 'docs/adr/0029-pages-share-one-skeleton-pageshell-and-page-types.md',
    },
    messages,
    schema: [],
  },
  create(context) {
    const filename = context.filename
    if (isExempt(filename)) return {}
    const routed = isRoutedPage(filename)

    const imports = new Map() // local name -> import source
    const rendered = new Set()
    let defaultExport = null

    return {
      ImportDeclaration(node) {
        for (const s of node.specifiers) imports.set(s.local.name, node.source.value)
      },
      ExportDefaultDeclaration(node) {
        defaultExport = node
      },
      JSXOpeningElement(node) {
        if (node.name.type !== 'JSXIdentifier') return
        const name = node.name.name
        if (name === 'PageHeader' || /(^|\/)PageHeader(\.jsx)?$/.test(imports.get(name) ?? '')) {
          context.report({ node, messageId: 'header' })
        }
        rendered.add(name)
      },
      'Program:exit'(program) {
        if (!routed) return
        if (rendered.has('PageShell') && /(^|\/)PageShell(\.jsx)?$/.test(imports.get('PageShell') ?? '')) return
        if (rendered.size > 0 && [...rendered].every((name) => name === 'Navigate')) return
        const viaLayout = [...rendered].some((name) => {
          const file = imports.has(name) && resolveImport(imports.get(name), filename, context.cwd)
          return file && rendersPageShell(file)
        })
        if (!viaLayout) context.report({ node: defaultExport ?? program, messageId: 'noShell' })
      },
    }
  },
}
