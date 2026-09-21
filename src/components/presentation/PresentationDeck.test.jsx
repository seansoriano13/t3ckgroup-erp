import { describe, it, expect } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"
import PresentationDeck from "./PresentationDeck"

// The deck is driven from a keyboard in front of an audience, so what is
// tested here is what would be embarrassing live: the wrong slide, a dead
// arrow key, a roadmap that overstates what shipped, or a prototype framed
// without its warning.

const data = {
  title: "What shipped since 9 September",
  since: "2026-09-09",
  generatedAt: "2026-09-16T06:00:00.000Z",
  headline: [
    {
      id: "flow-one-canvas",
      block: "Flow Canvas",
      title: "Flow Canvas is one canvas",
      impact: "There used to be two places to edit a flow.",
      changes: ["The Sandbox is gone.", "One editing surface."],
      issues: [186],
      sample: "stock-badges",
    },
    {
      id: "crm-board",
      block: "CRM",
      title: "CRM, and a board you drag SORs across",
      impact: "Dragging was impossible before.",
      changes: ["One column per Sale Type."],
      issues: [206],
      sample: "sors-rename",
    },
  ],
  underTheHood: {
    summary: "Correctness, safety and housekeeping.",
    items: [
      { title: "Migrations are append-only", issues: [184] },
      { title: "Toasts stay clickable", issues: [175] },
    ],
  },
  roadmap: {
    openCount: 74,
    openTicketCount: 3,
    epicCount: 2,
    ticketCount: 7,
    unassigned: [],
    phases: [
      {
        name: "Finish CRM",
        epics: [
          {
            number: 206,
            title: "CRM register",
            unlocks: "The register stops being a list.",
            total: 5,
            done: 4,
            open: [289],
            tickets: [
              { number: 286, title: "CRM rename", open: true, shipped: true },
              { number: 289, title: "Deleted bin", open: true, shipped: false },
            ],
          },
        ],
      },
      {
        name: "IPAS v1",
        epics: [
          {
            number: 241,
            title: "IPAS v1",
            unlocks: "Every Odoo purchase order recorded.",
            total: 2,
            done: 0,
            open: [242, 243],
            tickets: [
              { number: 242, title: "Raise an IPAS", open: true, shipped: false },
              { number: 243, title: "Odoo copy", open: true, shipped: false },
            ],
          },
        ],
      },
    ],
  },
  prototypes: [
    {
      id: "printed-ipas",
      title: "Printed IPAS",
      note: "The IPAS as it would be printed.",
      file: "/prototypes/printed-ipas.html",
      variants: ["A", "B", "C"],
      epic: 241,
    },
  ],
}

const press = (key) => fireEvent.keyDown(window, { key })

describe("PresentationDeck", () => {
  it("opens on the first headline row", () => {
    render(<PresentationDeck data={data} />)
    expect(
      screen.getByRole("heading", { name: "Flow Canvas is one canvas" }),
    ).toBeInTheDocument()
    expect(screen.getByText("1 / 2 · What shipped")).toBeInTheDocument()
  })

  it("says so plainly rather than white-screening when nothing was generated", () => {
    render(<PresentationDeck data={{ ...data, headline: [], underTheHood: { summary: "", items: [] }, roadmap: { phases: [] }, prototypes: [] }} />)
    expect(screen.getByText(/Nothing to present yet/i)).toBeInTheDocument()
    expect(screen.getByText("pnpm presentation")).toBeInTheDocument()
  })

  it("states that nothing here is live yet", () => {
    render(<PresentationDeck data={data} />)
    expect(
      screen.getByText(/Built and testable on staging/i),
    ).toBeInTheDocument()
  })

  it("walks forward and back through the headline rows", () => {
    render(<PresentationDeck data={data} />)
    press("ArrowRight")
    expect(
      screen.getByRole("heading", { name: /a board you drag SORs across/i }),
    ).toBeInTheDocument()
    press("ArrowLeft")
    expect(
      screen.getByRole("heading", { name: "Flow Canvas is one canvas" }),
    ).toBeInTheDocument()
  })

  it("rolls from the end of a section into the next one", () => {
    render(<PresentationDeck data={data} />)
    press("ArrowRight")
    press("ArrowRight")
    expect(
      screen.getByRole("heading", { name: /2 fixes and safety changes/i }),
    ).toBeInTheDocument()
  })

  it("jumps between sections without walking every slide", () => {
    render(<PresentationDeck data={data} />)
    press("ArrowDown")
    press("ArrowDown")
    expect(screen.getByRole("heading", { name: "Finish CRM" })).toBeInTheDocument()
    expect(screen.getByText("1 / 2 · What's left")).toBeInTheDocument()
  })

  it("does not fall off the start of the deck", () => {
    render(<PresentationDeck data={data} />)
    press("ArrowLeft")
    press("ArrowLeft")
    expect(
      screen.getByRole("heading", { name: "Flow Canvas is one canvas" }),
    ).toBeInTheDocument()
  })

  it("keeps the detail collapsed until asked", () => {
    render(<PresentationDeck data={data} />)
    expect(screen.queryByText("The Sandbox is gone.")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /What changed exactly \(2\)/ }))
    expect(screen.getByText("The Sandbox is gone.")).toBeInTheDocument()
  })

  it("mounts the sample a row names, and only that row", () => {
    render(<PresentationDeck data={data} />)
    // The real Product List stock badges, fed made-up lines.
    expect(screen.getByText(/The real component, with sample data/i)).toBeInTheDocument()
    expect(screen.getByText("Out of stock")).toBeInTheDocument()
    press("ArrowRight")
    // The real SORS tab strip, and not the stock badges.
    expect(screen.getByRole("tablist")).toBeInTheDocument()
    expect(screen.queryByText("Out of stock")).not.toBeInTheDocument()
  })

  it("gives every row of the generated deck a component to show", async () => {
    const { default: presentation } = await import("../../data/presentation.json")
    const { SAMPLES } = await import("./sampleRegistry")
    for (const row of presentation.headline) {
      expect(SAMPLES[row.sample], row.id).toBeTypeOf("function")
    }
  })

  it("counts the under-the-hood work without spending a slide on each item", () => {
    render(<PresentationDeck data={data} />)
    press("ArrowDown")
    expect(screen.getByText("1 / 1 · Under the hood")).toBeInTheDocument()
    expect(screen.queryByText(/Migrations are append-only/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Show the list" }))
    expect(screen.getByText(/Migrations are append-only/)).toBeInTheDocument()
  })

  describe("the roadmap", () => {
    it("shows an epic as a fraction, not as done or not done", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowDown")
      press("ArrowDown")
      expect(screen.getByText("4 / 5")).toBeInTheDocument()
    })

    it("admits when work shipped but its ticket was never closed", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowDown")
      press("ArrowDown")
      fireEvent.click(screen.getByRole("button", { name: /CRM register/ }))
      expect(screen.getByText(/shipped · ticket still open/)).toBeInTheDocument()
    })

    it("counts open tickets, not the epics that parent them", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowDown")
      press("ArrowDown")
      expect(screen.getByText(/3 of 7 tickets still open across all 2 epics/)).toBeInTheDocument()
      // The first phase has one open ticket, and says so rather than repeating the total.
      expect(screen.getByText(/1 of 5 tickets in this phase are still open/)).toBeInTheDocument()
    })

    it("puts no dates on the screen", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowDown")
      press("ArrowDown")
      expect(screen.getByText(/No dates on this screen on purpose/)).toBeInTheDocument()
    })
  })

  describe("the prototypes", () => {
    it("warns that nothing is built behind them", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowDown")
      press("ArrowDown")
      press("ArrowDown")
      expect(screen.getByText(/nothing built behind it/i)).toBeInTheDocument()
    })

    it("frames the first treatment and switches on demand", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowDown")
      press("ArrowDown")
      press("ArrowDown")
      expect(screen.getByTitle(/treatment A/)).toHaveAttribute(
        "src",
        "/prototypes/printed-ipas.html?variant=A",
      )
      fireEvent.click(screen.getByRole("button", { name: "C" }))
      expect(screen.getByTitle(/treatment C/)).toHaveAttribute(
        "src",
        "/prototypes/printed-ipas.html?variant=C",
      )
    })
  })

  describe("the overview", () => {
    it("opens on O and lists every slide", () => {
      render(<PresentationDeck data={data} />)
      press("o")
      const main = screen.getByRole("main")
      expect(
        within(main).getByRole("button", { name: "Flow Canvas is one canvas" }),
      ).toBeInTheDocument()
      expect(within(main).getByRole("button", { name: "Printed IPAS" })).toBeInTheDocument()
    })

    it("jumps straight to a slide picked from it", () => {
      render(<PresentationDeck data={data} />)
      press("o")
      fireEvent.click(screen.getByRole("button", { name: "IPAS v1" }))
      expect(screen.getByRole("heading", { name: "IPAS v1" })).toBeInTheDocument()
      expect(screen.getByText("2 / 2 · What's left")).toBeInTheDocument()
    })

    it("closes on Escape without moving the deck", () => {
      render(<PresentationDeck data={data} />)
      press("ArrowRight")
      press("o")
      press("Escape")
      expect(
        screen.getByRole("heading", { name: /a board you drag SORs across/i }),
      ).toBeInTheDocument()
    })

    it("opens on Escape from a slide, so Escape always means back", () => {
      render(<PresentationDeck data={data} />)
      press("Escape")
      const main = screen.getByRole("main")
      expect(
        within(main).getByRole("button", { name: "Printed IPAS" }),
      ).toBeInTheDocument()
    })

    it("does not let arrow keys move the deck underneath it", () => {
      render(<PresentationDeck data={data} />)
      press("o")
      press("ArrowRight")
      press("Escape")
      expect(
        screen.getByRole("heading", { name: "Flow Canvas is one canvas" }),
      ).toBeInTheDocument()
    })
  })
})
