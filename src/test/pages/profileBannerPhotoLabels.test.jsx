import { screen, waitFor, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi, beforeEach } from "vitest"

import ProfilePage from "@/pages/profile/index.jsx"
import ImageCropModal from "@/components/ImageCropModal.jsx"
import { employeeService } from "@/services/employeeService"
import { renderWithProviders } from "@/test/support"
import { makeEmployee } from "@/test/factories"

/** Spec #1133 / #1136: My Profile banner check, bad photo, labels, and a save that changes no row. */

let authUser
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: authUser, updateUserPreferences: vi.fn() }),
}))
vi.mock("@/services/storageService", () => ({
  storageService: { getSignedUrl: () => "", uploadProfileImage: vi.fn() },
}))
vi.mock("@/hooks/useUnsavedGuard", () => ({ useUnsavedGuard: () => {} }))

beforeEach(() => {
  const e = makeEmployee({ name: "Dani" })
  authUser = { id: e.id, name: "Dani", email: "dani@x.com", isHead: false, isHr: false, isSuperAdmin: false, dashboardQuote: "" }
  URL.createObjectURL ??= () => "blob:preview"
  URL.revokeObjectURL ??= () => {}
})

describe("My Profile", () => {
  it("uses the new labels and quote hint", async () => {
    renderWithProviders(<ProfilePage />)
    expect(await screen.findByText("Tasks completed")).toBeInTheDocument()
    expect(screen.queryByText("Activities Completed")).toBeNull()
    expect(screen.getByPlaceholderText("A short line for your Dashboard (up to 100 characters)")).toBeInTheDocument()
  })

  it("explains a banner link that is not https and keeps Save off", async () => {
    const user = userEvent.setup()
    renderWithProviders(<ProfilePage />)
    const box = await screen.findByLabelText("Banner image URL")
    await user.type(box, "not a url")
    expect(screen.getByText(/must start with https:\/\//i)).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: /save settings/i })[0]).toBeDisabled()
    await user.clear(box)
    await user.type(box, "https://images.example.com/a.jpg")
    expect(screen.queryByText(/must start with https:\/\//i)).toBeNull()
    expect(screen.getAllByRole("button", { name: /save settings/i })[0]).toBeEnabled()
  })
})

describe("ImageCropModal", () => {
  it("closes and says so when the file is not a picture", async () => {
    const onCancel = vi.fn()
    const origImage = globalThis.Image
    globalThis.Image = class {
      set src(_v) {
        setTimeout(() => this.onerror?.(), 0)
      }
    }
    try {
      renderWithProviders(
        <ImageCropModal file={new File(["hi"], "a.txt", { type: "text/plain" })} isOpen onConfirm={vi.fn()} onCancel={onCancel} />,
      )
      await waitFor(() => expect(onCancel).toHaveBeenCalled())
    } finally {
      globalThis.Image = origImage
    }
  })
})

describe("employeeService.updateSelfPreferences", () => {
  it("throws when no row changed", async () => {
    const { supabase } = await import("@/lib/supabase")
    const spy = vi.spyOn(supabase, "from").mockReturnValue({
      update: () => ({ eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    })
    await expect(employeeService.updateSelfPreferences("x", { dashboardQuote: "hi" })).rejects.toThrow(
      "Could not save. Reload the page and try again.",
    )
    spy.mockRestore()
  })
})
