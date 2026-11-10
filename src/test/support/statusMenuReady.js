import { expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"

/** Waits until an open status menu has finished opening; until then it takes no clicks. */
export const statusMenuReady = () =>
  waitFor(() => expect(screen.getByRole("menu")).not.toHaveAttribute("aria-busy", "true"))
