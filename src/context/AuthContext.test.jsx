import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import toast from "react-hot-toast"
import { AuthProvider, useAuth } from "./AuthContext"
import { supabase } from "@/lib/supabase"
import { markRecoveryActive } from "@/lib/recoveryFlag"
import { makeEmployee, makeHrEmployee } from "@/test/factories"

/**
 * Identity for the whole app. Every permission check downstream reads the user
 * this provider resolves, so the rules that matter are: a Supabase session only
 * becomes a user if there is a matching employee record, an unmatched session
 * is signed out rather than left half-authenticated, and a network blip falls
 * back to the cached profile instead of logging everyone out.
 */
function Probe() {
  const { user, isAuthLoading, logout, updateUserPreferences, handleLogin } = useAuth()
  return (
    <div>
      <span data-testid="loading">{String(isAuthLoading)}</span>
      <span data-testid="name">{user?.name ?? "anonymous"}</span>
      <span data-testid="is-hr">{String(user?.isHr ?? false)}</span>
      <span data-testid="picture">{user?.picture ?? ""}</span>
      <button onClick={() => logout()}>Log out</button>
      <button onClick={() => updateUserPreferences({ dashboardQuote: "New quote" })}>
        Save preference
      </button>
      <button onClick={() => handleLogin("someone@t3ckgroup.test")}>Check login</button>
      <span data-testid="quote">{user?.dashboardQuote ?? ""}</span>
    </div>
  )
}

/** Drives supabase.auth.onAuthStateChange without a real session. */
function stubAuthState(session) {
  let listener
  vi.spyOn(supabase.auth, "onAuthStateChange").mockImplementation((callback) => {
    listener = callback
    queueMicrotask(() => callback("INITIAL_SESSION", session))
    return { data: { subscription: { unsubscribe: vi.fn() } } }
  })
  return { emit: (event, next) => listener?.(event, next) }
}

const sessionFor = (email, metadata = {}) => ({
  user: { id: "auth-1", email, user_metadata: metadata },
})

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>)

/**
 * jsdom's Location methods cannot be spied on, so the whole object is swapped
 * for a plain stand-in. logout() navigates to /login, which jsdom would
 * otherwise refuse with "Not implemented: navigation".
 */
function stubLocation() {
  const replace = vi.fn()
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, href: window.location.href, replace, assign: vi.fn() },
  })
  return replace
}

describe("AuthContext", () => {
  let navigate

  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(toast, "error").mockImplementation(() => "id")
    vi.spyOn(toast, "success").mockImplementation(() => "id")
    navigate = stubLocation()
  })

  describe("resolving a session", () => {
    it("leaves the app anonymous when there is no session", async () => {
      stubAuthState(null)

      renderAuth()

      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))
      expect(screen.getByTestId("name")).toHaveTextContent("anonymous")
    })

    it("resolves the employee record behind the session", async () => {
      makeHrEmployee({ name: "HR Officer", email: "hr@t3ckgroup.test" })
      stubAuthState(sessionFor("hr@t3ckgroup.test"))

      renderAuth()

      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("HR Officer"))
      expect(screen.getByTestId("is-hr")).toHaveTextContent("true")
    })

    it("stops loading once the session has settled", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })
      stubAuthState(sessionFor("ana@t3ckgroup.test"))

      renderAuth()

      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))
    })

    it("signs out a session with no matching employee", async () => {
      const signOut = vi.spyOn(supabase.auth, "signOut")
      stubAuthState(sessionFor("stranger@t3ckgroup.test"))

      renderAuth()

      await waitFor(() => expect(signOut).toHaveBeenCalled())
      expect(screen.getByTestId("name")).toHaveTextContent("anonymous")
    })

    it("leaves a recovery session alone while a reset is in flight", async () => {
      // A password reset in another tab flags itself in localStorage; this tab
      // must not treat the recovery session it sees via storage sync as a login
      // to resolve — or, worse, sign it out for having no employee record.
      markRecoveryActive()
      const signOut = vi.spyOn(supabase.auth, "signOut")
      stubAuthState(sessionFor("stranger@t3ckgroup.test"))

      renderAuth()

      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))
      expect(signOut).not.toHaveBeenCalled()
      expect(screen.getByTestId("name")).toHaveTextContent("anonymous")
    })

    it("still clears the tab on a genuine sign-out while a reset is in flight", async () => {
      // The recovery guard covers the session-bearing branch only: that is the
      // one that resolves an employee and, finding none, signs out. Swallowing
      // SIGNED_OUT as well would leave every tab showing a signed-in user for
      // the flag's whole TTL, long after the session was actually gone.
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })
      const auth = stubAuthState(sessionFor("ana@t3ckgroup.test"))
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana Reyes"))

      markRecoveryActive()
      await waitFor(() => auth.emit("SIGNED_OUT", null))

      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("anonymous"))
    })

    it("refuses a deactivated employee", async () => {
      makeEmployee({ name: "Former Staff", email: "gone@t3ckgroup.test", is_deleted: true })
      const signOut = vi.spyOn(supabase.auth, "signOut")
      stubAuthState(sessionFor("gone@t3ckgroup.test"))

      renderAuth()

      await waitFor(() => expect(signOut).toHaveBeenCalled())
    })

    it("clears the user when the session ends", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })
      const auth = stubAuthState(sessionFor("ana@t3ckgroup.test"))
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana Reyes"))

      await waitFor(() => auth.emit("SIGNED_OUT", null))

      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("anonymous"))
    })
  })

  describe("the profile picture", () => {
    it("uses the employee's own avatar when they have one", async () => {
      makeEmployee({
        name: "Ana Reyes",
        email: "ana@t3ckgroup.test",
        avatar_path: "https://cdn.test/ana.png",
      })
      stubAuthState(sessionFor("ana@t3ckgroup.test", { picture: "https://google.test/ana.png" }))

      renderAuth()

      await waitFor(() =>
        expect(screen.getByTestId("picture")).toHaveTextContent("https://cdn.test/ana.png"),
      )
    })

    it("falls back to the Google picture when the employee has none", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test", avatar_path: null })
      stubAuthState(sessionFor("ana@t3ckgroup.test", { picture: "https://google.test/ana.png" }))

      renderAuth()

      await waitFor(() =>
        expect(screen.getByTestId("picture")).toHaveTextContent("https://google.test/ana.png"),
      )
    })
  })

  describe("surviving a network failure", () => {
    it("keeps the cached profile rather than logging the user out", async () => {
      localStorage.setItem(
        "t3ck_user_profile",
        JSON.stringify({ email: "ana@t3ckgroup.test", name: "Ana Reyes (cached)", isHr: false }),
      )
      vi.spyOn(supabase.auth, "signOut")
      const lookup = vi
        .spyOn(await import("@/services/employeeService").then((m) => m.employeeService), "getEmployeeByEmail")
        .mockRejectedValue(new Error("Network down"))
      stubAuthState(sessionFor("ana@t3ckgroup.test"))

      renderAuth()

      await waitFor(() =>
        expect(screen.getByTestId("name")).toHaveTextContent("Ana Reyes (cached)"),
      )
      expect(lookup).toHaveBeenCalled()
    })

    it("ignores a cached profile belonging to a different account", async () => {
      localStorage.setItem(
        "t3ck_user_profile",
        JSON.stringify({ email: "someone-else@t3ckgroup.test", name: "Someone Else" }),
      )
      vi.spyOn(
        await import("@/services/employeeService").then((m) => m.employeeService),
        "getEmployeeByEmail",
      ).mockRejectedValue(new Error("Network down"))
      stubAuthState(sessionFor("ana@t3ckgroup.test"))

      renderAuth()

      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))
      expect(screen.getByTestId("name")).toHaveTextContent("anonymous")
    })
  })

  describe("logging out", () => {
    it("clears the user and the cached profile", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })
      stubAuthState(sessionFor("ana@t3ckgroup.test"))
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana Reyes"))

      await userEvent.click(screen.getByRole("button", { name: "Log out" }))

      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("anonymous"))
      expect(localStorage.getItem("t3ck_user_profile")).toBeNull()
    })

    it("still clears the session locally when the sign-out call fails", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })
      stubAuthState(sessionFor("ana@t3ckgroup.test"))
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana Reyes"))
      vi.spyOn(supabase.auth, "signOut").mockResolvedValue({ error: new Error("offline") })

      await userEvent.click(screen.getByRole("button", { name: "Log out" }))

      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("anonymous"))
      expect(navigate).toHaveBeenCalledWith("/login")
    })
  })

  describe("preferences", () => {
    it("applies a preference change without another round trip", async () => {
      makeEmployee({ name: "Ana Reyes", email: "ana@t3ckgroup.test" })
      stubAuthState(sessionFor("ana@t3ckgroup.test"))
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Ana Reyes"))

      await userEvent.click(screen.getByRole("button", { name: "Save preference" }))

      expect(screen.getByTestId("quote")).toHaveTextContent("New quote")
      expect(JSON.parse(localStorage.getItem("t3ck_user_profile")).dashboardQuote).toBe(
        "New quote",
      )
    })
  })

  describe("pre-flight login check", () => {
    it("rejects an address with no employee record", async () => {
      stubAuthState(null)
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))

      await userEvent.click(screen.getByRole("button", { name: "Check login" }))

      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledWith("Unauthorized: Your email is not registered."),
      )
    })

    it("accepts a registered address", async () => {
      makeEmployee({ name: "Someone", email: "someone@t3ckgroup.test" })
      stubAuthState(null)
      renderAuth()
      await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("false"))

      await userEvent.click(screen.getByRole("button", { name: "Check login" }))

      await waitFor(() => expect(toast.error).not.toHaveBeenCalled())
    })
  })

  it("refuses to be used outside the provider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})

    expect(() => render(<Probe />)).toThrow("useAuth must be used within an AuthProvider")

    consoleError.mockRestore()
  })
})
