import { Linter } from 'eslint'
import { describe, expect, it } from 'vitest'
import rule from './no-iso-date-slice.js'

function lint(code, filename = 'src/foo.js') {
  const linter = new Linter()
  return linter.verify(
    code,
    [{ files: ['**/*.js'], plugins: { local: { rules: { r: rule } } }, rules: { 'local/r': 'error' } }],
    { filename },
  )
}

describe('local/no-iso-date-slice', () => {
  it('fails on toISOString().slice(0, 10)', () => {
    expect(lint('const d = new Date().toISOString().slice(0, 10)')).toHaveLength(1)
  })
  it("fails on .split('T')[0]", () => {
    expect(lint("const d = x.toISOString().split('T')[0]")).toHaveLength(1)
  })
  it('passes on a plain toISOString()', () => {
    expect(lint('const d = new Date().toISOString()')).toHaveLength(0)
  })
  it('passes inside the shared module', () => {
    expect(lint('const d = now.toISOString().slice(0, 10)', 'src/lib/manilaDate.js')).toHaveLength(0)
  })
})
