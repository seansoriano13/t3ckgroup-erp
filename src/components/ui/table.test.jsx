import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

function Sample(props) {
  return (
    <Table {...props}>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow data-testid="row" className="extra">
          <TableCell data-testid="cell">Ada</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

describe("Table", () => {
  it("renders semantic table structure", () => {
    render(<Sample />);
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getAllByRole("rowgroup")).toHaveLength(2);
    expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Ada" })).toBeInTheDocument();
  });

  it("passes className and props through", () => {
    render(<Sample className="min-w-[900px]" aria-label="People" />);
    const table = screen.getByRole("table", { name: "People" });
    expect(table).toHaveClass("min-w-[900px]");
    expect(screen.getByTestId("row")).toHaveClass("extra");
  });

  it("head handles clicks", () => {
    const onClick = vi.fn();
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead onClick={onClick}>Sort</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    screen.getByText("Sort").click();
    expect(onClick).toHaveBeenCalled();
  });
});

describe("Table column resizing", () => {
  const Resizable = () => (
    <Table tableId="t">
      <TableHeader>
        <TableRow>
          <TableHead id="a">A</TableHead>
          <TableHead id="b">B</TableHead>
          <TableHead>C</TableHead>
        </TableRow>
      </TableHeader>
    </Table>
  );

  it("only identified headers get a handle, and none without tableId", () => {
    localStorage.clear();
    const { unmount } = render(<Resizable />);
    expect(document.querySelectorAll("[data-slot=table-col-resizer]")).toHaveLength(2);
    unmount();
    render(<Sample />);
    expect(document.querySelector("[data-slot=table-col-resizer]")).toBeNull();
  });

  it("drag saves width (min 60) and double-click resets", () => {
    localStorage.clear();
    render(<Resizable />);
    const handle = document.querySelector("[data-slot=table-col-resizer]");
    fireEvent(handle, Object.assign(new Event("pointerdown", { bubbles: true }), { clientX: 100 }));
    fireEvent(window, Object.assign(new Event("pointermove"), { clientX: 500 }));
    fireEvent(window, new Event("pointerup"));
    const key = "erp_colwidths_anon_t";
    expect(JSON.parse(localStorage.getItem(key)).a).toBeGreaterThanOrEqual(60);
    fireEvent(window, Object.assign(new Event("pointermove"), { clientX: -9999 }));
    fireEvent.doubleClick(handle);
    expect(JSON.parse(localStorage.getItem(key) ?? "{}").a).toBeUndefined();
  });
});

describe("Table scrollCue", () => {
  const setSize = (scrollWidth, clientWidth) => {
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(scrollWidth);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(clientWidth);
  };
  afterEach(() => vi.restoreAllMocks());

  it("shows a right-edge cue when the table overflows", () => {
    setSize(900, 300);
    const { container } = render(<Sample scrollCue />);
    expect(container.querySelector('[data-slot="table-scroll-cue"][data-edge="right"]')).toBeInTheDocument();
    expect(container.querySelector('[data-edge="left"]')).not.toBeInTheDocument();
  });

  it("shows no cue when the table fits", () => {
    setSize(300, 300);
    const { container } = render(<Sample scrollCue />);
    expect(container.querySelector('[data-slot="table-scroll-cue"]')).not.toBeInTheDocument();
  });

  it("adds no cue without the prop", () => {
    setSize(900, 300);
    const { container } = render(<Sample />);
    expect(container.querySelector('[data-slot="table-scroll-cue"]')).not.toBeInTheDocument();
  });
});
