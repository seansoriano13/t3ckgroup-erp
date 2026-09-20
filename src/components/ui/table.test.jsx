import { describe, it, expect, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import { setupUser } from "@/test/support"

import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "./table"

function Sample(props) {
  return (
    <Table aria-label="Tasks" {...props}>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Write report</TableCell>
          <TableCell>Open</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Ship it</TableCell>
          <TableCell>Done</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

describe("Table", () => {
  it("renders a semantic table: named table, column headers, rows and cells", () => {
    render(<Sample />)
    const table = screen.getByRole("table", { name: "Tasks" })
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Title", "Status"])
    expect(within(table).getAllByRole("row")).toHaveLength(3)
    expect(within(table).getByRole("cell", { name: "Write report" })).toBeInTheDocument()
  })

  it("passes className and native props to each part", () => {
    render(
      <Table className="min-w-[900px]" data-testid="t">
        <TableHeader className="head-x">
          <TableRow className="row-x" data-testid="r">
            <TableHead className="th-x" scope="col" colSpan={2}>Name</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="body-x">
          <TableRow>
            <TableCell className="td-x" colSpan={2}>Ana</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    expect(screen.getByTestId("t")).toHaveClass("min-w-[900px]")
    expect(screen.getByTestId("r")).toHaveClass("row-x")
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("th-x")
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveAttribute("colspan", "2")
    expect(screen.getByRole("cell", { name: "Ana" })).toHaveClass("td-x")
  })

  it("leaves interaction to the screen: row and header handlers just work", async () => {
    const user = setupUser()
    const onRow = vi.fn()
    const onSort = vi.fn()
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead onClick={onSort}>Title</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow onClick={onRow}>
            <TableCell>Write report</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    )
    await user.click(screen.getByRole("columnheader", { name: "Title" }))
    await user.click(screen.getByRole("cell", { name: "Write report" }))
    expect(onSort).toHaveBeenCalledTimes(1)
    expect(onRow).toHaveBeenCalledTimes(1)
  })

  it("styles the wrapper separately from the table", () => {
    const { container } = render(<Sample containerClassName="max-h-40" />)
    expect(container.querySelector('[data-slot="table-container"]')).toHaveClass("max-h-40")
  })
})
