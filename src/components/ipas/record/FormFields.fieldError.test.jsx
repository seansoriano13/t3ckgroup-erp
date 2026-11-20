import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./FormFields";

// #1123: a date outside the limits says why, not just a red box.
describe("Field error sentence", () => {
  it("shows the sentence under the box", () => {
    render(<Field id="d" label="Date" kind="date" value="2099-01-01" error="The payment date cannot be after today." onChange={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The payment date cannot be after today.");
  });
  it("shows nothing when the value is fine", () => {
    render(<Field id="d" label="Date" kind="date" value="2026-11-01" onChange={() => {}} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
