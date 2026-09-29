import { describe, it, expect } from "vitest"
import { planTemplateTransfer } from "../../../scripts/lib/groupTaskTemplateTransfer.mjs"

// #419: Group Task Templates move staging -> prod with employees matched by
// name, not uuid. Missing/ambiguous names and template name clashes stop the run.

const S = { ann: "s-ann", bob: "s-bob" }
const sourceEmployees = [{ id: S.ann, name: "Ann Cruz" }, { id: S.bob, name: "Bob Reyes" }]
const targetEmployees = [{ id: "t-ann", name: "Ann Cruz" }, { id: "t-bob", name: "Bob Reyes" }]
const templates = [
    { id: "tpl1", name: "Onboarding", created_by: S.ann, archived_at: "2026-01-01T00:00:00Z" },
    { id: "tpl2", name: "Closeout", created_by: S.bob, archived_at: null },
]
const members = [
    { id: "m1", template_id: "tpl1", employee_id: S.bob },
    { id: "m2", template_id: "tpl1", employee_id: null },
    { id: "m3", template_id: "tpl2", employee_id: S.ann },
]
const base = { templates, members, sourceEmployees, targetEmployees, targetTemplateNames: [] }

describe("planTemplateTransfer", () => {
    it("remaps created_by and member employee_id by name, keeps archived_at and null members", () => {
        const { errors, templates: t, members: m } = planTemplateTransfer(base)
        expect(errors).toEqual([])
        expect(t.map((x) => x.created_by)).toEqual(["t-ann", "t-bob"])
        expect(t[0].archived_at).toBe("2026-01-01T00:00:00Z")
        expect(m.map((x) => x.employee_id)).toEqual(["t-bob", null, "t-ann"])
    })

    it("lists names missing on the target", () => {
        const { errors } = planTemplateTransfer({ ...base, targetEmployees: [targetEmployees[0]] })
        expect(errors).toEqual([expect.stringContaining("Bob Reyes")])
        expect(errors[0]).toMatch(/missing/i)
    })

    it("lists names ambiguous on the target", () => {
        const { errors } = planTemplateTransfer({ ...base, targetEmployees: [...targetEmployees, { id: "t-ann2", name: "ann cruz " }] })
        expect(errors).toEqual([expect.stringContaining("Ann Cruz")])
        expect(errors[0]).toMatch(/ambiguous/i)
    })

    it("stops when the target already has a template of the same name", () => {
        const { errors } = planTemplateTransfer({ ...base, targetTemplateNames: ["closeout"] })
        expect(errors).toEqual([expect.stringContaining("Closeout")])
    })

    it("with skipExisting, leaves same-named templates and their members out and lists them", () => {
        const { errors, templates: t, members: m, skipped } = planTemplateTransfer({
            ...base, targetTemplateNames: ["closeout"], skipExisting: true,
        })
        expect(errors).toEqual([])
        expect(skipped).toEqual(["Closeout"])
        expect(t.map((x) => x.id)).toEqual(["tpl1"])
        expect(m.map((x) => x.id)).toEqual(["m1", "m2"])
    })

    it("with skipExisting, a skipped template's unknown employees don't stop the run", () => {
        const { errors } = planTemplateTransfer({
            ...base, targetEmployees: [targetEmployees[1]], targetTemplateNames: ["onboarding"], skipExisting: true,
        })
        // Ann only created Onboarding (skipped) and is a member of Closeout: still needed.
        expect(errors).toEqual([expect.stringContaining("Ann Cruz")])
    })
})
