/**
 * The Canvass button of a product line. A Canvass belongs to the whole Purchase Request since
 * spec #956 (#967 changed the tables), not to a line, so the per-line panel this button opened is
 * gone. The request's Canvass grid, opened at a line, arrives with #970; until then the line has no
 * Canvass button. What the line says about its Canvass lives in its notes column (ProductLineCells).
 */
export default function ItemCanvass() {
  return null;
}
