import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PageShell from "./PageShell";
import EmptyState from "./EmptyState";

const before = (a, b) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("PageShell", () => {
  it("renders the slots in the fixed order whatever order the Page passes them", () => {
    render(
      <PageShell
        body={<div>body-slot</div>}
        toolbar={<div>toolbar-slot</div>}
        tabs={<div>tabs-slot</div>}
        action={<button type="button">main-action</button>}
        description="description-slot"
        title="Some Page"
      />,
    );

    const order = [
      screen.getByRole("heading", { name: /Some\s*Page/ }),
      screen.getByText("description-slot"),
      screen.getByText("main-action"),
      screen.getByText("tabs-slot"),
      screen.getByText("toolbar-slot"),
      screen.getByText("body-slot"),
    ];
    order.slice(1).forEach((el, i) => expect(before(order[i], el)).toBe(true));
  });

  it("takes the body as children too", () => {
    render(<PageShell title="Some Page">child-body</PageShell>);
    expect(screen.getByText("child-body")).toBeInTheDocument();
  });

  it("is centred unless the Page asks for full-width", () => {
    const { container, rerender } = render(<PageShell title="A" />);
    expect(container.firstChild.className).toContain("max-w-7xl");
    rerender(<PageShell title="A" frame="full" />);
    expect(container.firstChild.className).toContain("max-w-full");
  });

  it("omits slots the Page leaves empty", () => {
    render(<PageShell title="A" />);
    expect(screen.queryByTestId("page-tabs")).toBeNull();
    expect(screen.queryByTestId("page-toolbar")).toBeNull();
  });
});

describe("EmptyState", () => {
  it("shows a title and one line", () => {
    render(<EmptyState title="Nothing here" description="Come back later" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
    expect(screen.getByText("Come back later")).toBeInTheDocument();
  });
});
