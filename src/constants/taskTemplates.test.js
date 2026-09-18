import { describe, it, expect } from "vitest"
import { renderTemplate, DEFAULT_TITLE_TEMPLATE, TEMPLATE_VARIABLES } from "./taskTemplates"

describe("renderTemplate", () => {
  const ctx = {
    salesReference: "S01234",
    projectTitle: "Clinic Renovation",
    company: "Acme Corp",
    stageName: "Proposal Submitted",
    dealOwnerName: "Jane Dela Cruz",
    saleType: "Retail",
  }

  it("replaces a token anywhere in the string", () => {
    expect(renderTemplate("Prefix {{so_number}} Suffix", ctx)).toBe("Prefix S01234 Suffix")
  })

  it("replaces repeated tokens", () => {
    expect(renderTemplate("{{so_number}} / {{so_number}}", ctx)).toBe("S01234 / S01234")
  })

  it("falls back to 'No SO yet' when so_number is missing", () => {
    expect(renderTemplate("{{so_number}}", { ...ctx, salesReference: null })).toBe("No SO yet")
  })

  it("falls back to 'Untitled Project' when project_title is missing", () => {
    expect(renderTemplate("{{project_title}}", { ...ctx, projectTitle: "" })).toBe("Untitled Project")
  })

  it("leaves unknown tokens as written", () => {
    expect(renderTemplate("{{not_a_real_key}}", ctx)).toBe("{{not_a_real_key}}")
  })

  it("renders DEFAULT_TITLE_TEMPLATE for an empty template", () => {
    expect(renderTemplate("", ctx)).toBe(renderTemplate(DEFAULT_TITLE_TEMPLATE, ctx))
    expect(renderTemplate(null, ctx)).toBe(renderTemplate(DEFAULT_TITLE_TEMPLATE, ctx))
  })

  it("is a no-op on a token-free string (back-compat with typed titles)", () => {
    expect(renderTemplate("Literal Title", ctx)).toBe("Literal Title")
  })

  it("resolves every declared variable", () => {
    const all = TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join("|")
    expect(renderTemplate(all, ctx)).toBe(
      "S01234|Clinic Renovation|Acme Corp|Proposal Submitted|Jane Dela Cruz|Retail"
    )
  })

  it("default template matches the old [ref] [project] shape", () => {
    expect(renderTemplate(DEFAULT_TITLE_TEMPLATE, ctx)).toBe("[S01234] [Clinic Renovation]")
    expect(renderTemplate(DEFAULT_TITLE_TEMPLATE, {})).toBe("[No SO yet] [Untitled Project]")
  })
})
