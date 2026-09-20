import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

// Runs the project's real ESLint config on source strings, so this tests what
// `pnpm lint` reports, not a helper.
const eslint = new ESLint({ cwd: process.cwd() })

async function lint(code, filePath = 'src/pages/Example.jsx') {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((m) => m.ruleId === 'local/no-raw-html' || m.message.startsWith('eslint-disable of local/no-raw-html'))
}

const wrap = (jsx) => `export default function X() { return (${jsx}) }\n`

describe('local/no-raw-html', () => {
  it.each([
    ['<button>go</button>', /Raw <button>.*Button.*DESIGN\.md#button/],
    ['<input type="text" />', /Raw <input>.*Input.*DESIGN\.md#input/],
    ['<input type="date" />', /Input/],
    ['<input />', /Input/],
    ['<input type="number" />', /Input/],
    ['<input type="checkbox" />', /Checkbox/],
    ['<input type="file" />', /FileInput/],
    ['<input type="range" />', /Slider.*DESIGN.md#slider/],
    ['<textarea />', /Textarea.*DESIGN\.md#textarea/],
    ['<select />', /Select.*DESIGN\.md#select/],
    ['<label>x</label>', /FieldBox.*DESIGN\.md#fieldbox/],
    ['<table />', /Table/],
    ['<img src="a" />', /Avatar.*ImageAttachment/],
    ['<a href="/x">x</a>', /Link/],
    ['<div className="fixed inset-0 bg-black/50" />', /Dialog.*DESIGN\.md#dialog/],
    ['<div className={`fixed inset-0 ${open ? "a" : "b"}`} />', /Dialog/],
  ])('reports %s in feature code and names the Primitive', async (jsx, message) => {
    const messages = await lint(wrap(jsx))
    expect(messages).toHaveLength(1)
    expect(messages[0].severity).toBe(2)
    expect(messages[0].message).toMatch(message)
  })

  it('allows every covered element inside the shared UI folder', async () => {
    const code = wrap(`<div className="fixed inset-0"><button /><input /><textarea /><select /><label /><table /><img /><a /></div>`)
    expect(await lint(code, 'src/components/ui/thing.jsx')).toEqual([])
    expect(await lint(code, String.raw`src\components\ui\thing.jsx`)).toEqual([])
  })

  it('does not flag form, layout tags, paragraphs, headings or Primitives', async () => {
    const code = wrap(`<form><div><span><ul><li><p>a</p><h1>b</h1><h3>c</h3></li></ul></span></div><Button /><Link to="/" /><motion.button /></form>`)
    expect(await lint(code)).toEqual([])
  })

  it('does not flag a positioned overlay that is not full-screen', async () => {
    expect(await lint(wrap('<div className="fixed bottom-0 right-0" />'))).toEqual([])
  })

  it('is not applied to test files', async () => {
    expect(await lint(wrap('<button />'), 'src/components/Thing.test.jsx')).toEqual([])
  })

  it.each([
    ['line', 'export default function X() { return <button /> } // eslint-disable-line local/no-raw-html'],
    ['next-line', '// eslint-disable-next-line local/no-raw-html\nexport default function X() { return <button /> }'],
    ['block', '/* eslint-disable local/no-raw-html */\nexport default function X() { return <button /> }'],
    ['blanket', '/* eslint-disable */\nexport default function X() { return <button /> }'],
  ])('refuses %s eslint-disable for itself in feature code', async (_name, code) => {
    const messages = await lint(code)
    expect(messages.some((m) => /eslint-disable.*not allowed/.test(m.message))).toBe(true)
  })

  it('does not object to disabling other rules', async () => {
    const code = '// eslint-disable-next-line no-console\nexport const x = 1\n'
    expect(await lint(code)).toEqual([])
  })
})
