import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"

import SorModalHeader from "./SorModalHeader"

const STAGES = [
  { code: "LEAD", label: "Lead", theme: "blue" },
  { code: "QUOTED", label: "Quoted", theme: "amber" },
  { code: "CLOSED_WON", label: "Closed Won", theme: "green", is_won: true },
  { code: "CLOSED_LOST", label: "Closed Lost", theme: "red", is_lost: true },
]

function renderAt(status) {
  render(
    <SorModalHeader
      opportunity={{ id: "opp", status, client_name: "Client" }}
      isFlowDeal={false}
      pipelineStages={STAGES}
      stageMutation={{ isPending: false }}
      handleStageChange={() => {}}
      checklist={[]}
      updateMutation={{ isPending: false }}
      deleteMutation={{ isPending: false }}
      handleEditToggle={() => {}}
      onClose={() => {}}
    />,
  )
}

const tile = (name) => screen.getByRole("button", { name: new RegExp(name, "i") })

describe("SorModalHeader legacy ribbon", () => {
  it("does not green Closed Won on a Closed Lost deal", () => {
    renderAt("CLOSED_LOST")
    expect(tile("Closed Won").className).not.toMatch(/bg-green-9/)
    expect(tile("Closed Won").className).toMatch(/bg-muted/)
    expect(tile("Quoted").className).toMatch(/bg-amber-9\/20/)
  })

  it("still marks earlier stages completed on a won deal", () => {
    renderAt("CLOSED_WON")
    expect(tile("Quoted").className).toMatch(/bg-amber-9\/20/)
    expect(tile("Closed Lost").className).toMatch(/bg-muted/)
  })
})
