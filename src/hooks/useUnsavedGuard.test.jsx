import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { RouterProvider, createMemoryRouter, Link } from "react-router"
import { useUnsavedGuard, UNSAVED_MESSAGE } from "./useUnsavedGuard"

function Form({ dirty }) {
  useUnsavedGuard(dirty)
  return <Link to="/other">leave</Link>
}

function setup(dirty) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <Form dirty={dirty} /> },
      { path: "/other", element: <p>other page</p> },
    ],
    { initialEntries: ["/"] },
  )
  render(<RouterProvider router={router} />)
  return router
}

afterEach(() => vi.restoreAllMocks())

describe("useUnsavedGuard", () => {
  it("does not prompt when nothing changed", async () => {
    const confirm = vi.spyOn(window, "confirm")
    setup(false)
    fireEvent.click(screen.getByText("leave"))
    expect(await screen.findByText("other page")).toBeTruthy()
    expect(confirm).not.toHaveBeenCalled()
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it("prompts on in-app navigation and stays when declined", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const router = setup(true)
    fireEvent.click(screen.getByText("leave"))
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(UNSAVED_MESSAGE))
    expect(router.state.location.pathname).toBe("/")
  })

  it("leaves when the prompt is accepted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    setup(true)
    fireEvent.click(screen.getByText("leave"))
    expect(await screen.findByText("other page")).toBeTruthy()
  })

  it("asks the browser to confirm close or reload while dirty", () => {
    setup(true)
    const event = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
