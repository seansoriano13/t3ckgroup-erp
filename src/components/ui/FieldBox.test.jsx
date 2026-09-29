import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FieldBox } from "./FieldBox";
import { Input } from "./input";

describe("FieldBox", () => {
  it("associates the label with a lone control", () => {
    render(
      <FieldBox label="Full name">
        <Input />
      </FieldBox>,
    );
    expect(screen.getByLabelText("Full name")).toBe(screen.getByRole("textbox"));
  });

  it("keeps a control's own id", () => {
    render(
      <FieldBox label="Email">
        <Input id="mail" />
      </FieldBox>,
    );
    expect(screen.getByLabelText("Email")).toHaveAttribute("id", "mail");
  });

  it("bare renders the control without the box", () => {
    const { container } = render(
      <FieldBox label="Note" bare>
        <Input />
      </FieldBox>,
    );
    expect(container.querySelector("[class*=min-h-]")).toBeNull();
    expect(screen.getByLabelText("Note")).toBeInTheDocument();
  });

  it("caption only takes htmlFor", () => {
    render(
      <>
        <FieldBox label="Amount" htmlFor="amt" />
        <Input id="amt" />
      </>,
    );
    expect(screen.getByLabelText("Amount")).toHaveAttribute("id", "amt");
  });

  it("inline wraps a checkbox row", () => {
    render(
      <FieldBox inline>
        <input type="checkbox" /> Remember me
      </FieldBox>,
    );
    expect(screen.getByLabelText("Remember me")).toBeInTheDocument();
  });
});
