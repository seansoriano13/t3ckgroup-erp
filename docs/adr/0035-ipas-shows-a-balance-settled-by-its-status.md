# An IPAS shows a Remaining balance, settled by its IPAS Status

**Status:** accepted (2026-10-21)

When payments were built (#244) we decided the ERP would never show a balance
for an IPAS: tax withheld from a payment means the supplier is paid less than
the PO total, so "PO total minus payments" would leave a fully settled order
owing that withheld amount forever. Purchasing's IPAS sheet, which the ERP
replaces, leads with a Balance column, so we reversed this: the IPAS list shows
**Remaining balance = Amount − payments** (Amount is the P.I/QT Amount, or the Odoo PO total when none is typed), and shows **0 once the IPAS Status is Paid or
Done**, which the IPAS reaches once a full payment is recorded or it is filed.

## Consequences

- **A non-zero Remaining balance on a Paid or Done IPAS is never shown.** Anyone reading
  the code should not "fix" the zero back to the subtraction: the difference is
  usually tax withheld.
- **Remaining balance is only as right as the status.** An order whose last payment is
  recorded as a down payment or plain payment, never as a full payment, keeps
  showing the withheld amount as owing.
