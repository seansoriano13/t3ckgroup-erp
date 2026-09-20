import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { setupUser } from "@/test/support"

vi.mock("../../services/faqService", () => ({
  loadFAQFromDB: () => Promise.resolve([]),
}))
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { role: "employee" } }),
}))

import FAQModal from "./FAQModal"

const renderModal = (props) =>
  render(
    <MemoryRouter>
      <FAQModal isOpen onClose={() => {}} {...props} />
    </MemoryRouter>
  )

describe("FAQModal", () => {
  it("shows the Help & FAQ panel when open and nothing when closed", () => {
    const { rerender } = renderModal({ isOpen: false })
    expect(screen.queryByText("Help & FAQ")).not.toBeInTheDocument()
    rerender(
      <MemoryRouter>
        <FAQModal isOpen onClose={() => {}} />
      </MemoryRouter>
    )
    expect(screen.getByText("Help & FAQ")).toBeInTheDocument()
  })

  it("closes on Escape", async () => {
    const user = setupUser()
    const onClose = vi.fn()
    renderModal({ onClose })
    expect(screen.getByText("Help & FAQ")).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalled()
  })

  it("stays open on a click inside the panel and exposes it as a dialog", async () => {
    const user = setupUser()
    const onClose = vi.fn()
    renderModal({ onClose })
    await user.click(screen.getByText("Help & FAQ"))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })
})
