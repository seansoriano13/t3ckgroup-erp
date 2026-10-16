/**
 * Order Monitoring (spec #261): the steps an ageing rule can be set on, in the
 * order an order runs. The first seven are the IPAS buyer track; the last three
 * are the hand-off facts (a delivery with no Transmittal, a Transmittal check
 * still open, costs complete and ready to file). The keys are the database's
 * `order_ageing_rules.step` values, so they must match the migration.
 */
export const ORDER_AGEING_STEPS = [
  { key: "purchase_order", label: "Purchase Order" },
  { key: "with_pop", label: "With P.O.P" },
  { key: "import_clearance", label: "Import Clearance" },
  { key: "delivered", label: "Delivered" },
  { key: "received_in_odoo", label: "Received in Odoo" },
  { key: "create_bill", label: "Create Bill" },
  { key: "actual_checking", label: "Actual Checking" },
  { key: "no_transmittal", label: "Delivered, no Transmittal raised" },
  { key: "check_open", label: "Transmittal check open" },
  { key: "ready_to_file", label: "Costs complete, ready to file" },
];

/**
 * Example days shown beside a blank rule as a hint only. Nothing is set from
 * these; a step stays without a rule until Purchasing types a number.
 */
export const ORDER_AGEING_HINTS = {
  import_clearance: 3,
  create_bill: 7,
};

/**
 * The four groups the Order Monitoring page shows (#263, spec #261), in the
 * order the page draws them. Filed is collapsed by default.
 */
export const ORDER_GROUP = {
  NEEDS_CHASING: "needs_chasing",
  WAITING_ON_US: "waiting_on_us",
  WAITING_ON_OTHERS: "waiting_on_others",
  FILED: "filed",
};

export const ORDER_GROUPS = [
  ORDER_GROUP.NEEDS_CHASING,
  ORDER_GROUP.WAITING_ON_US,
  ORDER_GROUP.WAITING_ON_OTHERS,
  ORDER_GROUP.FILED,
];

export const ORDER_GROUP_LABELS = {
  [ORDER_GROUP.NEEDS_CHASING]: "Needs chasing",
  [ORDER_GROUP.WAITING_ON_US]: "Waiting on us",
  [ORDER_GROUP.WAITING_ON_OTHERS]: "Waiting on someone else",
  [ORDER_GROUP.FILED]: "Filed",
};

/**
 * Who owes the next thing. Everyone inside the company is "us"; only the
 * supplier, forwarder and port are OTHERS.
 */
export const ORDER_OWNER = {
  PURCHASING: "purchasing",
  FINANCE: "finance",
  WAREHOUSE: "warehouse",
  TECHNICAL: "technical",
  CHECK_BY: "check_by",
  SIGNERS: "signers",
  OTHERS: "others",
};

export const ORDER_OWNER_LABELS = {
  [ORDER_OWNER.PURCHASING]: "Purchasing",
  [ORDER_OWNER.FINANCE]: "Finance",
  [ORDER_OWNER.WAREHOUSE]: "Warehouse",
  [ORDER_OWNER.TECHNICAL]: "Technical",
  [ORDER_OWNER.CHECK_BY]: "Check by signers",
  [ORDER_OWNER.SIGNERS]: "Section 7 signers",
  [ORDER_OWNER.OTHERS]: "Supplier, forwarder or port",
};
