import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { server } from "@/test/msw/server"
import { createTestQueryClient } from "@/test/support"
import { QueryClientProvider } from "@tanstack/react-query"
import ReleaseNotesSection from "./ReleaseNotesView"
import { SECTIONS } from "./content"
import { SAMPLES, SAMPLE_MODE } from "./sampleRegistry"
import { SAMPLE_EMPLOYEES } from "./sampleData"

// Every employee opens Release Notes on prod (ADR 0030). What is tested here
// is what would go wrong in front of all of them: a screen that reads or
// writes real records, a sample that blanks its section, an item pointing at
// a sample that does not exist, or a real colleague's name in the Sample Data.

vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "viewer", name: "Viewer" }, isSuperAdmin: false }),
}))
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "viewer", name: "Viewer" }, isSuperAdmin: false }),
}))

let requests = []
const record = ({ request }) => requests.push(`${request.method} ${request.url}`)
beforeEach(() => {
  requests = []
  server.events.on("request:start", record)
})
afterEach(() => {
  server.events.removeListener("request:start", record)
})

function renderSection(section) {
  // The app's own query client sits outside, as it does on the real page: a
  // sample that escaped its sandbox would fetch through this one and be seen.
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <ReleaseNotesSection section={section} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

describe("Release Notes content", () => {
  const items = SECTIONS.flatMap((s) => s.items)

  it("gives every item a title, a line of copy and who uses it", () => {
    for (const item of items) {
      expect(item.title, item.id).toBeTruthy()
      expect(item.body, item.id).toBeTruthy()
      expect(item.who?.length, item.id).toBeGreaterThan(0)
    }
  })

  it("points every sample key at a registered sample, and registers none unused", () => {
    const named = items.map((i) => i.sample).filter(Boolean)
    for (const key of named) expect(SAMPLES[key], key).toBeTypeOf("function")
    expect(Object.keys(SAMPLES).sort()).toEqual([...new Set(named)].sort())
  })

  it("marks only registered samples as look-only or screenshots", () => {
    // A stale key here would leave a locked sample inviting clicks.
    for (const [key, mode] of Object.entries(SAMPLE_MODE)) {
      expect(SAMPLES[key], key).toBeTypeOf("function")
      expect(["look", "pictures"], key).toContain(mode)
    }
  })

  it("uses no item id twice, so a link to one lands on one", () => {
    const ids = items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("never names a colleague: the Sample Data cast is made up", () => {
    // The first cut of this page used real staff names; these are the ones
    // it used. The cast in sampleData.js must not drift back to them.
    const real = ["Galacgac", "Saliva", "Duran"]
    for (const p of SAMPLE_EMPLOYEES) {
      for (const name of real) expect(p.name).not.toContain(name)
    }
  })
})

describe("Release Notes sections", () => {
  for (const section of SECTIONS) {
    it(`${section.label}: every sample shows, and nothing reaches the network`, async () => {
      renderSection(section)
      await flush()

      for (const item of section.items) {
        expect(screen.getByRole("heading", { name: item.title })).toBeInTheDocument()
      }
      expect(screen.queryByText("This example could not be shown.")).not.toBeInTheDocument()
      expect(requests).toEqual([])
    })
  }
})

describe("Release Notes samples", () => {
  // Click everything a sample offers, including what its pop-ups offer once
  // open, and submit every form. Sample Data has no rows behind it, and the
  // viewer is on prod: nothing may be read or saved.
  for (const [key, Sample] of Object.entries(SAMPLES)) {
    it(`${key}: clicking everything reaches no database`, async () => {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter>
            <ReleaseNotesSection
              section={{ key, label: key, intro: "", items: [{ id: key, title: key, body: key, who: ["Test"], sample: key }] }}
            />
          </MemoryRouter>
        </QueryClientProvider>,
      )
      expect(Sample).toBeTypeOf("function")
      await flush()

      const clicked = new WeakSet()
      for (let round = 0; round < 3; round++) {
        // Buttons, and the rows and cards that open something when clicked.
        const buttons = [
          ...within(document.body).queryAllByRole("button"),
          ...document.body.querySelectorAll("tbody tr"),
        ].filter((b) => !clicked.has(b) && !b.disabled)
        if (buttons.length === 0) break
        for (const button of buttons) {
          if (!button.isConnected) continue
          clicked.add(button)
          fireEvent.click(button)
          await flush()
        }
        for (const form of document.body.querySelectorAll("form")) {
          fireEvent.submit(form)
          await flush()
        }
      }

      expect(screen.queryByText("This example could not be shown.")).not.toBeInTheDocument()
      expect(requests).toEqual([])
    })
  }
})
