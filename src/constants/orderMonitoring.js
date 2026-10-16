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
