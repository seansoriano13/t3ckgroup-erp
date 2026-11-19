import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Test", email: "t@x.com", dashboardBannerPath: null, dashboardQuote: "" },
    updateUserPreferences: vi.fn(),
  }),
}))
vi.mock("../../lib/supabase", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ then: () => {} }) }) }) }) },
}))
vi.mock("@/hooks/useUnsavedGuard", () => ({ useUnsavedGuard: () => {} }))
vi.mock("@/hooks/useScreenBand", () => ({ useIsPhone: () => false }))
vi.mock("../../components/ui/PageShell", () => ({
  default: ({ action, children }) => (
    <div>
      {action}
      {children}
    </div>
  ),
}))
vi.mock("../../components/ImageCropModal", () => ({ default: () => null }))
vi.mock("../../components/profile/SignatureCaptureModal", () => ({ default: () => null }))
vi.mock("@/components/ui/FileInput", () => ({ FileInput: () => null }))
vi.mock("../../services/storageService", () => ({ storageService: {} }))
vi.mock("../../services/employeeService", () => ({ employeeService: {} }))
vi.mock("../../services/signatureService", () => ({ signatureService: {} }))
vi.mock("../../services/passwordService", () => ({ passwordService: {} }))
vi.mock("../../services/aiService", () => ({ aiService: {} }))

import ProfilePage from "./index"

const MESSAGE = "Enter a web address that starts with https://"

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProfilePage />
    </QueryClientProvider>,
  )
}

describe("My Profile banner address", () => {
  it("shows the message and keeps Save off when the address is not https", () => {
    renderPage()
    fireEvent.change(screen.getByLabelText("Banner image URL"), { target: { value: "not a url" } })
    expect(screen.getByText(MESSAGE)).toBeTruthy()
    expect(screen.getByRole("button", { name: /save settings/i }).disabled).toBe(true)
  })

  it("refuses http:// too", () => {
    renderPage()
    fireEvent.change(screen.getByLabelText("Banner image URL"), { target: { value: "http://example.com/b.png" } })
    expect(screen.getByText(MESSAGE)).toBeTruthy()
  })

  it("turns Save on for an https address", () => {
    renderPage()
    fireEvent.change(screen.getByLabelText("Banner image URL"), { target: { value: "https://example.com/b.png" } })
    expect(screen.queryByText(MESSAGE)).toBeNull()
    expect(screen.getByRole("button", { name: /save settings/i }).disabled).toBe(false)
  })
})
