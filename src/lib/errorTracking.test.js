import { describe, it, expect } from "vitest"
import { scrubEvent, scrubBreadcrumb, scrubString, stripUrl } from "./errorTracking"

describe("scrubString", () => {
    it("hides money amounts, emails and tokens", () => {
        const out = scrubString("Paid ₱12,500.50 and $99 and PHP 1200 to ana.cruz@t3ck.com eyJhbGci.eyJzdWIi.sig_123")
        expect(out).not.toMatch(/12,500|\$99|1200|ana\.cruz|eyJ/)
        expect(out).toContain("[amount]")
        expect(out).toContain("[email]")
        expect(out).toContain("[token]")
    })
})

describe("stripUrl", () => {
    it("drops the query string and the hash (which can hold an auth token)", () => {
        expect(stripUrl("https://x.test/a/b?email=eq.ana@t3ck.com#access_token=abc")).toBe("https://x.test/a/b")
    })
})

describe("scrubEvent", () => {
    const base = () => ({
        user: { id: "u-1", email: "ana@t3ck.com", username: "Ana Cruz", ip_address: "1.2.3.4" },
        request: {
            url: "https://erp.test/costing?price=500#access_token=abc",
            method: "GET",
            headers: { cookie: "sb=secret" },
            data: { salary: 50000 },
            cookies: { sb: "secret" },
        },
        message: "Failed for ana@t3ck.com amount ₱5,000",
        exception: { values: [{ value: "Bad total ₱1,234.00 for ana@t3ck.com" }] },
        extra: {
            arguments: [
                "save failed",
                { name: "Ana Cruz", salary: 50000, price: 12 },
                new Error("oops ₱10"),
                { code: "23505", message: "duplicate key", details: "Key (email)=(ana@t3ck.com)" },
            ],
            salary: 50000,
            supabase_message: "ok",
        },
        breadcrumbs: [
            { category: "console", message: "employee Ana Cruz" },
            { category: "fetch", data: { url: "https://db.test/rest/v1/employees?email=eq.ana@t3ck.com", method: "GET", status_code: 400, body: "x" } },
            { category: "navigation", data: { from: "/a?x=1#h", to: "/b?y=2" } },
        ],
    })

    it("keeps only the user id", () => {
        expect(scrubEvent(base()).user).toEqual({ id: "u-1" })
    })

    it("drops request headers, cookies and body, and strips the url", () => {
        const { request } = scrubEvent(base())
        expect(request).toEqual({ url: "https://erp.test/costing", method: "GET" })
    })

    it("never lets names, salaries, prices, emails or amounts through", () => {
        const json = JSON.stringify(scrubEvent(base()))
        expect(json).not.toMatch(/Ana Cruz|ana@t3ck|50000|salary":\d|5,000|1,234|₱10|Key \(email\)|access_token/)
    })

    it("keeps a Supabase error's code and message but not its details", () => {
        const args = scrubEvent(base()).extra.arguments
        expect(args[3]).toEqual({ code: "23505", message: "duplicate key" })
        expect(args[1]).toBe("[object]")
    })

    it("drops console breadcrumbs and trims fetch breadcrumbs to method, status and path", () => {
        const crumbs = scrubEvent(base()).breadcrumbs
        expect(crumbs.find((c) => c.category === "console")).toBeUndefined()
        expect(crumbs.find((c) => c.category === "fetch").data).toEqual({
            method: "GET",
            status_code: 400,
            url: "https://db.test/rest/v1/employees",
        })
        expect(crumbs.find((c) => c.category === "navigation").data).toEqual({ from: "/a", to: "/b" })
    })
})

describe("scrubBreadcrumb", () => {
    it("returns null for nothing", () => {
        expect(scrubBreadcrumb(null)).toBeNull()
    })
})
