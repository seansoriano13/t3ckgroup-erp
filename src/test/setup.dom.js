import "@testing-library/jest-dom/vitest"
import { afterEach, beforeAll } from "vitest"
import { cleanup } from "@testing-library/react"

/**
 * What a rendered screen needs on top of the fake Supabase: Testing Library's
 * matchers and cleanup, and the browser APIs jsdom leaves out. Used by the
 * screens project only (see vitest.config.js), after setup.harness.js.
 */

beforeAll(() => {
  // jsdom does not implement scrollIntoView; components that call it to keep
  // a selected row in view would otherwise crash every test that renders them.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
  // Same for Element.scrollTo, which the SOR modal's stage ribbon calls from a
  // requestAnimationFrame. Unpolyfilled, it throws after the test body has
  // finished — an uncaught exception that makes `vitest run` exit 1 even
  // though every test passed.
  if (!Element.prototype.scrollTo) {
    Element.prototype.scrollTo = () => {}
  }
  // jsdom has no ResizeObserver. React Flow constructs one the moment it
  // mounts, so every test that renders the Flow Canvas — or any screen that
  // embeds it — throws before its first assertion without this.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  // jsdom has no matchMedia. Defaults every query to non-matching so a
  // width-gated layout (the SOR modal's chat-as-tab switch) renders its wide
  // form in tests unless a test stubs window.matchMedia itself.
  if (!window.matchMedia) {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  }
})

afterEach(() => {
  cleanup()
})
