import { screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { MemoryRouter } from "react-router"

import FlowCanvasAdminPage from "@/pages/super-admin/flow-canvas/index.jsx"
import ReleaseNotesPage from "@/pages/release-notes/index.jsx"
import { renderWithProviders } from "@/test/support"

/**
 * Tool pages (#444) keep their custom surfaces but render the shared PageShell
 * header: a compact title, description, and the main-action slot.
 */

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Admin", is_super_admin: true, isSuperAdmin: true },
    isSuperAdmin: true,
  }),
}))

function chainable() {
  const query = {
    select: () => query,
    order: () => query,
    is: () => query,
    then: (resolve) => resolve({ data: [], error: null }),
  }
  return { from: () => query }
}
vi.mock("@/lib/supabase.js", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, supabase: chainable() }
})

describe("Flow Canvas on PageShell", () => {
  it("renders the PageShell header with the canvas in the body", async () => {
    renderWithProviders(<FlowCanvasAdminPage />)

    const heading = await screen.findByRole("heading", { level: 1, name: /flow\s*canvas/i })
    expect(heading).toBeInTheDocument()

    const body = screen.getByTestId("page-body")
    expect(await within(body).findByText("No Sale Types yet")).toBeInTheDocument()
    expect(within(body).queryByRole("heading", { level: 1 })).not.toBeInTheDocument()
  })
})

describe("Release Notes on PageShell", () => {
  it("renders the PageShell title over one level-1 tab per section", async () => {
    renderWithProviders(
      <MemoryRouter initialEntries={["/release-notes?tab=next"]}>
        <ReleaseNotesPage />
      </MemoryRouter>,
    )

    // Samples inside the body may be whole pages with titles of their own;
    // the page's own title is the first.
    const headings = await screen.findAllByRole("heading", { level: 1 })
    expect(headings[0]).toHaveTextContent(/release\s*notes/i)
    const tabs = within(screen.getByTestId("page-tabs"))
    expect(tabs.getByRole("tab", { name: "SORs" })).toBeInTheDocument()
    expect(tabs.getByRole("tab", { name: "Coming next" })).toBeInTheDocument()
  })
})
