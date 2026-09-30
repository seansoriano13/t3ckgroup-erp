import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { ESLint } from 'eslint'

// Runs the project's real ESLint config on source strings, so this tests what
// `pnpm lint` reports, not a helper.
const eslint = new ESLint({ cwd: process.cwd() })

const RULE = 'local/require-page-shell'

async function lint(code, filePath = 'src/pages/example/index.jsx') {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((m) => m.ruleId === RULE || m.message.startsWith(`eslint-disable of ${RULE}`))
}

const page = (jsx, imports = '') => `${imports}\nexport default function X() { return (${jsx}) }\n`
const SHELL = `import PageShell from "@/components/ui/PageShell"`
const HEADER = `import PageHeader from "@/components/ui/PageHeader"`

describe('local/require-page-shell', () => {
  it('passes a routed page that renders PageShell', async () => {
    expect(await lint(page('<PageShell title="Things"><p>body</p></PageShell>', SHELL))).toEqual([])
  })

  it('fails a routed page that renders no PageShell', async () => {
    const messages = await lint(page('<div><h1>Things</h1></div>'))
    expect(messages).toHaveLength(1)
    expect(messages[0].severity).toBe(2)
    expect(messages[0].message).toMatch(/PageShell.*DESIGN\.md#pageshell/)
  })

  it('links to a PageShell heading that exists in DESIGN.md', () => {
    expect(readFileSync('DESIGN.md', 'utf8')).toMatch(/^#{3,4} PageShell$/m)
  })

  it('fails a page header rendered outside PageShell, even beside one', async () => {
    const messages = await lint(page('<PageShell title="A"><PageHeader title="B" /></PageShell>', `${SHELL}\n${HEADER}`))
    expect(messages).toHaveLength(1)
    expect(messages[0].severity).toBe(2)
    expect(messages[0].message).toMatch(/PageHeader.*PageShell/)
  })

  it('fails a page header rendered beside PageShell', async () => {
    const messages = await lint(page('<><PageHeader title="B" /><PageShell title="A" /></>', `${SHELL}\n${HEADER}`))
    expect(messages).toHaveLength(1)
    expect(messages[0].message).toMatch(/PageHeader/)
  })

  it('fails a PageShell that is not the shared Primitive', async () => {
    expect(await lint(page('<PageShell title="A" />'))).toHaveLength(1)
    expect(await lint(page('<PageShell title="A" />', 'import PageShell from "./MyShell"'))).toHaveLength(1)
  })

  it('fails a page header rendered by a non-page component', async () => {
    const messages = await lint(page('<PageHeader title="B" />', HEADER), 'src/components/Thing.jsx')
    expect(messages).toHaveLength(1)
    expect(messages[0].message).toMatch(/PageHeader/)
  })

  it('passes a page that renders a layout which itself renders PageShell', async () => {
    const relative = `import { ApprovalCenterLayout } from "../approvals/_components/ApprovalCenterLayout"`
    expect(await lint(page('<ApprovalCenterLayout />', relative))).toEqual([])
    const aliased = `import CommissionDashboardView from "@/components/sor/CommissionDashboardView"`
    expect(await lint(page('<CommissionDashboardView />', aliased))).toEqual([])
  })

  it('fails a page whose only components do not render PageShell', async () => {
    const imports = `import { Button } from "@/components/ui/button"`
    expect(await lint(page('<Button>go</Button>', imports))).toHaveLength(1)
  })

  it('passes a redirect-only route', async () => {
    const code = `import { Navigate } from "react-router"\nexport default function R({ ok }) {\n  if (ok) return <Navigate to="/a" replace />\n  return <Navigate to="/" replace />\n}\n`
    expect(await lint(code, 'src/pages/old/index.jsx')).toEqual([])
  })

  it('passes the screens outside the app frame (login, password reset, verify)', async () => {
    const code = page('<div>sign in</div>')
    expect(await lint(code, 'src/pages/login/index.jsx')).toEqual([])
    expect(await lint(code, 'src/pages/reset-password/index.jsx')).toEqual([])
    expect(await lint(code, 'src/pages/verify/[token].jsx')).toEqual([])
  })

  it('ignores files that are not routes', async () => {
    const code = page('<div>part</div>')
    expect(await lint(code, 'src/pages/example/_components/Part.jsx')).toEqual([])
    expect(await lint(code, 'src/pages/_app.jsx')).toEqual([])
    expect(await lint(code, 'src/pages/example/helpers.js')).toEqual([])
    expect(await lint(code, 'src/components/Part.jsx')).toEqual([])
  })

  it('exempts the shared UI folder and test files', async () => {
    const code = page('<PageHeader title="B" />', HEADER)
    expect(await lint(code, 'src/components/ui/PageShell.jsx')).toEqual([])
    expect(await lint(code, String.raw`src\components\ui\PageShell.jsx`)).toEqual([])
    expect(await lint(code, 'src/pages/example/index.test.jsx')).toEqual([])
  })

  it.each([
    ['line', 'export default function X() { return <div /> } // eslint-disable-line local/require-page-shell'],
    ['next-line', '// eslint-disable-next-line local/require-page-shell\nexport default function X() { return <div /> }'],
    ['block', '/* eslint-disable local/require-page-shell */\nexport default function X() { return <div /> }'],
    ['blanket', '/* eslint-disable */\nexport default function X() { return <div /> }'],
    ['inline config', '/* eslint local/require-page-shell: "off" */\nexport default function X() { return <div /> }'],
  ])('refuses %s eslint-disable for itself', async (_name, code) => {
    const messages = await lint(code)
    expect(messages.some((m) => /eslint-disable of local\/require-page-shell is not allowed/.test(m.message))).toBe(true)
  })
})
