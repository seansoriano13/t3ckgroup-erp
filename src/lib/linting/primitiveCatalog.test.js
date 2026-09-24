import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { ESLint } from 'eslint'

// The catalog is the agent-facing list of Primitives (ADR 0025). It is only
// useful if it is complete and its links resolve, so those are checked against
// the code and the lint rule, not by eye.
const eslint = new ESLint({ cwd: process.cwd() })
const design = readFileSync('DESIGN.md', 'utf8')
const catalog = design.slice(design.indexOf('### Primitive catalog')).split(/\n## /)[0]

// GitHub's heading slug: lowercase, drop punctuation, spaces to hyphens.
const slug = (heading) =>
  heading.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')
const anchors = [...catalog.matchAll(/^#{3,4} (.+)$/gm)].map(([, heading]) => slug(heading))

async function lintMessage(jsx) {
  const code = `export default function X() { return (${jsx}) }\n`
  const [result] = await eslint.lintText(code, { filePath: 'src/pages/Example.jsx' })
  return result.messages.find((m) => m.ruleId === 'local/no-raw-html')?.message
}

describe('Primitive catalog', () => {
  it.each([
    ['<button />', 'button'],
    ['<input />', 'input'],
    ['<input type="checkbox" />', 'checkbox'],
    ['<input type="file" />', 'fileinput'],
    ['<textarea />', 'textarea'],
    ['<select />', 'selectfield'],
    ['<label />', 'fieldbox'],
    ['<table />', 'table'],
    ['<img />', 'image'],
    ['<a />', 'externallink'],
    ['<div className="fixed inset-0" />', 'dialog'],
  ])('the lint message for %s links to #%s, and that heading exists', async (jsx, anchor) => {
    const message = await lintMessage(jsx)
    expect(message, 'the rule did not report this element').toContain(`See DESIGN.md#${anchor}.`)
    expect(anchors, `#${anchor} is not a heading in the Primitive catalog`).toContain(anchor)
  })

  it('lists every file in the shared UI folder', () => {
    const files = readdirSync('src/components/ui').filter((f) => /\.jsx?$/.test(f) && !/\.test\./.test(f))
    const unlisted = files.filter((f) => !catalog.includes(`\`ui/${f}\``))
    expect(unlisted, 'add these to the Primitive catalog').toEqual([])
  })

  it('names only files that exist', () => {
    const paths = [...catalog.matchAll(/`((?:ui\/)?[A-Za-z][\w-]*\.jsx?)`/g)].map(([, p]) => p)
    expect(paths.length).toBeGreaterThan(0)
    const missing = paths.filter((p) => !existsSync(`src/components/${p}`))
    expect(missing, 'the catalog names files that are not there').toEqual([])
  })
})
