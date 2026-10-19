import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import StageActionDetail from "./StageActionDetail";

describe("StageActionDetail", () => {
  it("renders an individual task's description, priority and checklist", () => {
    const action = {
      kind: "create_individual_task",
      config: {
        taskDescription: "Call the lead",
        priority: "HIGH",
        checklist: '[{"id":"1","text":"Confirm phone number","checked":false}]',
      },
    };
    render(<StageActionDetail action={action} employees={[]} />);

    expect(screen.getByText("Call the lead")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
    expect(screen.getByText("Confirm phone number")).toBeInTheDocument();
  });

  it("renders a group task's objective, due date and named members", () => {
    const action = {
      kind: "create_group_task",
      config: {
        description: "Review the submitted documents",
        dueDateOffsetDays: 2,
        members: [
          { employeeId: "emp-1", role: "Assignee" },
          { employeeId: "emp-2", role: "Reviewer" },
        ],
      },
    };
    const employees = [
      { id: "emp-1", name: "Alice" },
      { id: "emp-2", name: "Bob" },
    ];
    render(<StageActionDetail action={action} employees={employees} />);

    expect(screen.getByText("Review the submitted documents")).toBeInTheDocument();
    expect(screen.getByText(/2 days after the deal arrives/)).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("renders an Open Costing Matrix's Incharges, assigners and extra members", () => {
    const employees = [
      { id: "emp-1", name: "Raquel" },
      { id: "emp-2", name: "Mia" },
      { id: "emp-3", name: "Ana" },
    ];
    const action = {
      kind: "open_costing_matrix",
      config: {
        salesIncharge: { type: "employee", id: "emp-3" },
        assigners: [{ type: "employee", id: "emp-1" }],
        extras: [{ type: "employee", id: "emp-2" }],
        markupPresetId: "preset-1",
      },
    };
    render(<StageActionDetail action={action} employees={employees} />);

    expect(screen.getByText("Sales: Ana · Purchasing: not named · Markup: a markup preset")).toBeInTheDocument();
    expect(screen.getByText("Raquel")).toBeInTheDocument();
    expect(screen.getByText("Mia")).toBeInTheDocument();
  });

  it("says a Request Packing List tells the Warehouse list by default, or the people named", () => {
    const { unmount } = render(<StageActionDetail action={{ kind: "request_packing_list", config: {} }} employees={[]} />);
    expect(screen.getByText(/and tells the Warehouse list\./)).toBeInTheDocument();
    unmount();

    render(
      <StageActionDetail
        action={{ kind: "request_packing_list", config: { notify: [{ type: "employee", id: "emp-1" }] } }}
        employees={[{ id: "emp-1", name: "Pia" }]}
      />,
    );
    expect(screen.getByText(/and tells Pia\./)).toBeInTheDocument();
  });

  it("says an Open Costing Matrix defaults to the Deal Owner and tells nobody", () => {
    render(<StageActionDetail action={{ kind: "open_costing_matrix", config: {} }} employees={[]} />);

    expect(screen.getByText("Sales: Deal Owner · Purchasing: not named")).toBeInTheDocument();
    expect(screen.getByText("Nobody is told")).toBeInTheDocument();
  });

  it("falls back to 'Someone no longer listed' for a member id with no matching employee", () => {
    const action = {
      kind: "create_group_task",
      config: { members: [{ employeeId: "emp-deleted", role: "Assignee" }] },
    };
    render(<StageActionDetail action={action} employees={[]} />);

    expect(screen.getByText("Someone no longer listed")).toBeInTheDocument();
  });

  it("falls through to the individual-task layout for any kind other than create_group_task", () => {
    const action = { kind: "some_future_kind", config: { taskDescription: "Do the thing" } };
    render(<StageActionDetail action={action} employees={[]} />);

    expect(screen.getByText("Do the thing")).toBeInTheDocument();
  });

  describe("carries on past the stage", () => {
    const action = (config = {}) => ({ kind: "create_individual_task", config });

    it("is off by default", () => {
      render(<StageActionDetail action={action()} onCarriesOnChange={() => {}} />);
      expect(screen.getByRole("switch")).not.toBeChecked();
    });

    it("reads on when the config says so, and reports a toggle", () => {
      const onChange = vi.fn();
      render(<StageActionDetail action={action({ carries_on: true })} onCarriesOnChange={onChange} />);
      const box = screen.getByRole("switch");
      expect(box).toBeChecked();
      fireEvent.click(box);
      expect(onChange).toHaveBeenCalledWith(false);
    });

    it("cannot be toggled when disabled", () => {
      render(<StageActionDetail action={action()} disabled onCarriesOnChange={() => {}} />);
      expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
    });
  });
});
