/**
 * The badge palette, on its own so both ends of the status vocabulary can
 * reach it.
 *
 * It used to live in `status.js`. `procurement.js` needs it to build its
 * outcome→theme map, and `status.js` needs that map back to resolve a
 * procurement badge — a cycle in which whichever module evaluated second read
 * the other's constants before they were initialised. Splitting the palette
 * out leaves `procurement.js → statusTheme.js ← status.js`, so the arrow only
 * ever points one way.
 */

export const STATUS_THEME = {
  GREEN: "green",
  AMBER: "amber",
  BLUE: "blue",
  RED: "red",
  VIOLET: "violet",
  ORANGE: "orange",
  MAUVE: "mauve",
};
