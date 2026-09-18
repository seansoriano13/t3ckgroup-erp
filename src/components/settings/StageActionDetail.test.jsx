import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
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
});
