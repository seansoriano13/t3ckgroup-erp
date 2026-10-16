import NumbersStrip from "@/components/record/NumbersStrip";

/**
 * The four headline amounts, the only place they show on the record page. Each
 * one opens the section it comes from.
 */
export default function Figures({ digest, onOpen }) {
  const { money } = digest;
  return (
    <NumbersStrip
      stats={[
        {
          key: "po",
          label: "Odoo PO, before tax",
          value: money.poTotalText,
          sub: `${money.lineCount} ${money.lineCount === 1 ? "line" : "lines"}`,
          onOpen: () => onOpen("purchasing"),
        },
        {
          key: "paid",
          label: "Paid",
          value: money.paidText,
          sub:
            money.paymentCount > 0 ? (
              <>
                <span className="font-mono tabular-nums">{money.debitedPhpText}</span> debited
              </>
            ) : (
              "No payments yet"
            ),
          onOpen: () => onOpen("purchasing"),
        },
        {
          key: "charges",
          label: "Charges",
          value: money.chargesPhpText,
          sub: `${money.chargeCount} recorded`,
          onOpen: () => onOpen("finance"),
        },
        { key: "landed", label: "Landed Cost", value: money.landedText, onOpen: () => onOpen("costing") },
      ]}
    />
  );
}
