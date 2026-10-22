import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Button } from "@/components/ui/button";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import { setupUser } from "@/test/support";
import YourMoveCard from "./YourMoveCard";

const steps = [
  { key: "a", title: "Warehouse checking", summary: "Signed by Ann", state: "done", body: <p>Checked by Ann</p>, moves: null },
  {
    key: "b",
    title: "Check by",
    summary: "Waiting for the Check by list",
    state: "current",
    needsMe: true,
    body: <p>Two signatures needed</p>,
    moves: <Button className={APPROVE_CLASS}>Sign Check by (1)</Button>,
  },
  { key: "c", title: "Release", summary: "Optional", state: "waiting", body: <p>Not yet</p>, moves: null },
];

const stepButton = (name) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

describe("YourMoveCard", () => {
  it("shows its parts in order: heading, what is next, signed count, steps", () => {
    render(<YourMoveCard status="Waiting for you: Check by" next={<p>Next waiting for me: TG03_0008</p>} steps={steps} />);

    const order = ["Your move", "Waiting for you: Check by", "Next waiting for me: TG03_0008", "1 of 3 signed", "Warehouse checking", "Check by", "Release"];
    const positions = order.map((text) => screen.getByText(text));
    positions.slice(1).forEach((node, i) => {
      // DOCUMENT_POSITION_FOLLOWING: this node comes after the one before it.
      expect(positions[i].compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  it("names each step's state in words", () => {
    render(<YourMoveCard status="x" steps={steps} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Waiting")).toBeInTheDocument();
  });

  it("opens the step that needs the viewer on arrival and leaves the rest shut", () => {
    render(<YourMoveCard status="x" steps={steps} />);

    expect(stepButton("Check by")).toHaveAttribute("aria-expanded", "true");
    expect(stepButton("Warehouse checking")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Sign Check by (1)" })).toBeInTheDocument();
  });

  it("opens steps in place, several at once, and shuts one again", async () => {
    const user = setupUser();
    render(<YourMoveCard status="x" steps={steps} />);

    await user.click(stepButton("Warehouse checking"));
    await user.click(stepButton("Release"));
    expect(stepButton("Warehouse checking")).toHaveAttribute("aria-expanded", "true");
    expect(stepButton("Release")).toHaveAttribute("aria-expanded", "true");
    expect(stepButton("Check by")).toHaveAttribute("aria-expanded", "true");

    await user.click(stepButton("Check by"));
    expect(stepButton("Check by")).toHaveAttribute("aria-expanded", "false");
    // The step's work stays mounted but leaves the accessibility tree while shut.
    expect(screen.queryByRole("button", { name: "Sign Check by (1)" })).not.toBeInTheDocument();
  });

  it("opens a step that starts needing the viewer after an update", () => {
    const quiet = steps.map((s) => ({ ...s, needsMe: false }));
    const { rerender } = render(<YourMoveCard status="x" steps={quiet} />);
    expect(stepButton("Release")).toHaveAttribute("aria-expanded", "false");

    rerender(<YourMoveCard status="x" steps={quiet.map((s) => (s.key === "c" ? { ...s, needsMe: true } : s))} />);
    expect(stepButton("Release")).toHaveAttribute("aria-expanded", "true");
  });

  it("draws the record's own moves after the signed count, and no count without steps", () => {
    render(<YourMoveCard status="A draft." lead={<Button>Submit</Button>} steps={[]} />);

    expect(screen.getByRole("button", { name: "Submit" })).toBeInTheDocument();
    expect(screen.queryByText(/signed$/)).not.toBeInTheDocument();
  });
});
