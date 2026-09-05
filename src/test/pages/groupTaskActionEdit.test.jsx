import { screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import CreateGroupTaskModal from "@/pages/group-tasks/_components/CreateGroupTaskModal";
import { renderWithProviders } from "@/test/support";
import { makeEmployee } from "@/test/factories";

/**
 * Editing a `create_group_task` stage action reopens this modal with the config
 * that was persisted for it. That config carries no client-side member ids —
 * handleSubmit strips members down to their assignment fields — so the modal has
 * to mint them on the way in. When it did not, every row answered to `undefined`
 * and the rail became unusable: see the assertions below.
 */

const alice = () => makeEmployee({ name: "Alice Adams" });
const bob = () => makeEmployee({ name: "Bob Brown" });
const carol = () => makeEmployee({ name: "Carol Cruz" });

/** The shape stage_action.config actually stores: no `id` on any member. */
const savedConfig = (employees) => ({
  title: "Kickoff",
  description: "",
  dueOffsetDays: 3,
  members: employees.map((e, i) => ({
    employeeId: e.id,
    taskDescription: `${e.name} task ${i}`,
    checklist: null,
    role: "",
    customRole: "",
  })),
});

function openEditor(employees, onSubmit = () => {}) {
  renderWithProviders(
    <CreateGroupTaskModal
      isOpen
      onClose={() => {}}
      user={makeEmployee({ name: "Super" })}
      employees={employees}
      onSubmit={onSubmit}
      mode="automation"
      initialData={savedConfig(employees)}
    />,
  );
}

// The detail panel repeats the selected member's name in its assignee trigger,
// so row lookups have to be scoped to the rail.
const rail = () => screen.getByText(/^Members/).closest("div").parentElement;
const rowFor = (name) => within(rail()).getByText(name).closest("button");
const selectedRows = (names) =>
  names.filter((n) => rowFor(n).className.includes("ring-mauve-4"));

describe("editing a saved group task action", () => {
  it("opens with the first member selected", async () => {
    openEditor([alice(), bob()]);

    expect(await screen.findByDisplayValue(/Alice Adams task 0/)).toBeInTheDocument();
  });

  it("shows the member you click in the detail panel", async () => {
    openEditor([alice(), bob(), carol()]);

    fireEvent.click(rowFor("Bob Brown"));
    expect(await screen.findByDisplayValue(/Bob Brown task 1/)).toBeInTheDocument();

    fireEvent.click(rowFor("Carol Cruz"));
    expect(await screen.findByDisplayValue(/Carol Cruz task 2/)).toBeInTheDocument();
  });

  it("highlights only the selected row", async () => {
    const names = ["Alice Adams", "Bob Brown", "Carol Cruz"];
    openEditor([alice(), bob(), carol()]);

    await screen.findByText("Bob Brown");
    fireEvent.click(rowFor("Bob Brown"));

    expect(selectedRows(names)).toEqual(["Bob Brown"]);
  });

  it("keeps each member's edits to that member", async () => {
    const submitted = [];
    openEditor([alice(), bob()], (config) => submitted.push(config));

    await screen.findAllByText("Alice Adams");
    fireEvent.click(rowFor("Alice Adams"));
    fireEvent.change(await screen.findByDisplayValue(/Alice Adams task 0/), {
      target: { value: "ONLY ALICE" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create Group Task/i }));

    expect(submitted[0].members.map((m) => m.taskDescription)).toEqual([
      "ONLY ALICE",
      "Bob Brown task 1",
    ]);
  });
});
