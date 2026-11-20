import { beforeEach, describe, expect, it, vi } from "vitest"
import { passwordService } from "./passwordService"
import { stubEdgeFunction } from "@/test/msw/server"
import { supabase } from "@/lib/supabase"

/**
 * Seam D — the passwordService wraps the manage-employee-password edge
 * function and two auth entry points. The edge function itself (issue vs.
 * reissue authorisation, the Super Admin gate) is proven server-side; here
 * we only prove the service calls the right thing with the right shape and
 * surfaces a refusal as an error rather than swallowing it.
 */
describe("passwordService", () => {
  describe("issuePassword", () => {
    it("returns the generated password on success", async () => {
      stubEdgeFunction("manage-employee-password", (body) => {
        expect(body).toEqual({ employeeId: "emp-1", action: "issue" })
        return { success: true, password: "s3cr3t!", action: "issue" }
      })

      const password = await passwordService.issuePassword("emp-1")
      expect(password).toBe("s3cr3t!")
    })

    it("throws when the function refuses", async () => {
      stubEdgeFunction("manage-employee-password", () => ({
        success: false,
        message: "Employee not found.",
      }))

      await expect(passwordService.issuePassword("missing")).rejects.toThrow(/Employee not found/)
    })
  })

  describe("reissuePassword", () => {
    it("sends a reissue action and returns the new password", async () => {
      stubEdgeFunction("manage-employee-password", (body) => {
        expect(body).toEqual({ employeeId: "emp-2", action: "reissue" })
        return { success: true, password: "n3wPass!", action: "reissue" }
      })

      const password = await passwordService.reissuePassword("emp-2")
      expect(password).toBe("n3wPass!")
    })

    it("throws when reissue is refused because the employee already set their own password", async () => {
      stubEdgeFunction("manage-employee-password", () => ({
        success: false,
        message: "This employee has already set their own password. Direct them to email verification instead.",
      }))

      await expect(passwordService.reissuePassword("emp-3")).rejects.toThrow(/already set their own password/)
    })
  })

  describe("requestPasswordReset", () => {
    // The redirect is built from the page's origin. Service tests run in plain
    // Node, so the one browser global this entry point reads is supplied here.
    beforeEach(() => {
      vi.stubGlobal("window", { location: { origin: "https://erp.t3ckgroup.test" } })
    })

    it("delegates to supabase.auth.resetPasswordForEmail with a redirect", async () => {
      const spy = vi
        .spyOn(supabase.auth, "resetPasswordForEmail")
        .mockResolvedValue({ error: null })

      await passwordService.requestPasswordReset("a@t3ckgroup.test")

      expect(spy).toHaveBeenCalledWith(
        "a@t3ckgroup.test",
        expect.objectContaining({ redirectTo: expect.stringContaining("/reset-password") }),
      )
      spy.mockRestore()
    })

    it("accepts a normal address that contains the letter s", async () => {
      const spy = vi.spyOn(supabase.auth, "resetPasswordForEmail").mockResolvedValue({ error: null })
      await expect(passwordService.requestPasswordReset("sean@t3ckgroup.com")).resolves.not.toThrow()
      expect(spy).toHaveBeenCalledWith("sean@t3ckgroup.com", expect.anything())
      spy.mockRestore()
    })

    it("turns a rate limit into a plain sentence", async () => {
      const spy = vi
        .spyOn(supabase.auth, "resetPasswordForEmail")
        .mockResolvedValue({ error: Object.assign(new Error("rate limited"), { status: 429 }) })

      await expect(passwordService.requestPasswordReset("a@t3ckgroup.test")).rejects.toThrow(
        /too many reset emails/i,
      )
      spy.mockRestore()
    })

    it("turns a send failure into a plain sentence", async () => {
      const spy = vi
        .spyOn(supabase.auth, "resetPasswordForEmail")
        .mockResolvedValue({ error: new Error("Error sending recovery email") })

      await expect(passwordService.requestPasswordReset("a@t3ckgroup.test")).rejects.toThrow(
        "We could not send the email just now. Try again in a few minutes, or ask IT.",
      )
      spy.mockRestore()
    })

    it("checks the address shape before calling the provider", async () => {
      const spy = vi.spyOn(supabase.auth, "resetPasswordForEmail")

      await expect(passwordService.requestPasswordReset("not-an-email")).rejects.toThrow(
        "Enter a full email address, like name@t3ckgroup.com.",
      )
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
  })

  describe("clearIssuedPasswordFlag", () => {
    it("calls the clear_issued_password_flag rpc", async () => {
      const spy = vi.spyOn(supabase, "rpc").mockResolvedValue({ error: null })

      await passwordService.clearIssuedPasswordFlag()

      expect(spy).toHaveBeenCalledWith("clear_issued_password_flag")
      spy.mockRestore()
    })
  })
})
