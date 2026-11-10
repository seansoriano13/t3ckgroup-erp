import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { server } from "@/test/msw/server"
import { createTestQueryClient } from "@/test/support"
import { QueryClientProvider } from "@tanstack/react-query"
import ReleaseNotesSection, { ReleaseNotesOverview } from "./ReleaseNotesView"
import { SECTIONS } from "./content"
import { SAMPLES, SAMPLE_MODE } from "./sampleRegistry"
import { SAMPLE_EMPLOYEES } from "./sampleData"

// Every employee opens Release Notes on prod (ADR 0030). What is tested here
// is what would go wrong in front of all of them: a screen that reads or
// writes real records, a sample that blanks its section, an item pointing at
// a sample that does not exist, or a real colleague's name in the Sample Data.
//
// Throwaway code (ADR 0030, 2026-11 amendment): when a change to a real
// component makes a sample fail here, delete the sample. Never change the
// real component to keep it passing.

// Signed in as a viewer, unless a sample signs in its own made-up employee
// with SampleAuthProvider, as it does on the real page.
const { fakeAuth } = vi.hoisted(() => ({
  fakeAuth: async () => {
    const { createContext, createElement, useContext } = await import("react")
    const Auth = createContext({ user: { id: "viewer", name: "Viewer" }, isSuperAdmin: false })
    return {
      useAuth: () => useContext(Auth),
      SampleAuthProvider: ({ user, children }) => createElement(Auth.Provider, { value: { user } }, children),
    }
  },
}))
vi.mock("@/context/AuthContext", fakeAuth)
vi.mock("../../context/AuthContext", fakeAuth)

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
  // Every row is opened, so every sample mounts.
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <MemoryRouter>
        <ReleaseNotesSection section={section} defaultOpen="all" />
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

  it("lists new things before fixes in every tab, as the page groups them", () => {
    for (const section of SECTIONS) {
      const firstFix = section.items.findIndex((i) => i.kind === "fix")
      if (firstFix === -1) continue
      expect(section.items.slice(firstFix).every((i) => i.kind === "fix"), section.key).toBe(true)
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
        expect(screen.getByText(item.title).closest("button")).toHaveAttribute("aria-expanded", "true")
      }
      expect(screen.queryByText("This example could not be shown.")).not.toBeInTheDocument()
      expect(requests).toEqual([])
    })
  }
})

describe("Release Notes overview", () => {
  it("lists every new thing as one line, and counts each tab's fixes", () => {
    const onOpen = vi.fn()
    render(<ReleaseNotesOverview sections={SECTIONS} onOpen={onOpen} />)

    for (const section of SECTIONS) {
      const card = screen.getByRole("region", { name: section.label })
      for (const item of section.items.filter((i) => i.kind !== "fix")) {
        expect(within(card).getByRole("button", { name: item.title })).toBeInTheDocument()
      }
      const fixes = section.items.filter((i) => i.kind === "fix").length + (section.alsoFixed?.length ?? 0)
      if (fixes > 0) expect(within(card).getByRole("button", { name: new RegExp(`and ${fixes} fix`) })).toBeInTheDocument()
    }

    const [first] = SECTIONS
    fireEvent.click(screen.getByRole("button", { name: first.items[0].title }))
    expect(onOpen).toHaveBeenCalledWith(first.key, first.items[0].id)
  })
})

describe("Release Notes samples", () => {
  // Click everything a sample offers, including what its pop-ups offer once
  // open, and submit every form. Sample Data has no rows behind it, and the
  // viewer is on prod: nothing may be read or saved.
  if (Object.keys(SAMPLES).length === 0) it.todo("no samples this release")
  for (const [key, Sample] of Object.entries(SAMPLES)) {
    it(`${key}: clicking everything reaches no database`, async () => {
      render(
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter>
            <ReleaseNotesSection
              section={{ key, label: key, intro: "", items: [{ id: key, title: key, body: key, who: ["Test"], sample: key }] }}
              defaultOpen="all"
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
