import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
