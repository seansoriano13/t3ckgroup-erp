import { Fragment, createElement } from "react";

/**
 * A table's columns kept in one ordered list, so its headings and its cells
 * cannot drift apart: both are drawn from the same list. Moving a column is
 * moving its line in that list.
 *
 * Each column is `{ key, locked? }` plus whatever else the table keeps for it
 * (label, width, phone role). `show(key)` is the Columns picker's answer; a
 * locked column is always shown.
 */
export function shownColumns(columns, show = () => true) {
  return columns.filter((column) => column.locked || show(column.key));
}

/**
 * One row's cells, in the order of `columns`. `cells` maps a column key to a
 * function that draws that column's cell; only the columns given are drawn,
 * and a key with no cell draws nothing.
 */
export function cellsInOrder(columns, cells) {
  return columns.map((column) => createElement(Fragment, { key: column.key }, cells[column.key]?.() ?? null));
}
