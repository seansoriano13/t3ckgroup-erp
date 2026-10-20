import { ITEM_STATUS, isClosedStatus } from "../../constants/purchaseRequest";

export const EASE = [0.22, 1, 0.36, 1];
export const SPRING = { type: "spring", stiffness: 420, damping: 38 };

const TODO = [ITEM_STATUS.REQUESTED, ITEM_STATUS.TO_ORDER];
const GROUPS = [
  { key: "todo", label: "To do", test: (i) => TODO.includes(i.status) },
  { key: "doing", label: "In progress", test: (i) => !TODO.includes(i.status) && !isClosedStatus(i.status) },
  { key: "done", label: "Closed", test: (i) => isClosedStatus(i.status) },
];

/** The items split into To do / In progress / Closed, empty groups left out. */
export function groupItems(items) {
  return GROUPS.map((g) => ({ key: g.key, label: g.label, list: items.filter(g.test) })).filter((g) => g.list.length);
}
