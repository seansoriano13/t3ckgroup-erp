# Commission Pool Calculation Rulings & Strategic Split Architecture

## Status
Accepted

## Context
The Commission Pool module computes live, derived commission figures across all registered Sales Opportunity Records (SORs) per regulation `CCPR-2026-001`. A comprehensive architectural review surfaced discrepancies between the written regulation and software implementation regarding the Withholding Tax (ITR) calculation, the Strategic project split role model, stage progression constraints, Department Reserve Fund position seeds, and monetary privacy enforcement.

## Decision
1. **ITR / Commissionable Revenue Calculation**:
   - Retain the existing software calculation: `(Contract Value / (1 + VAT Rate)) * (1 - Withholding Rate)`.
   - The withholding tax percentage is applied to the VAT-exclusive amount as a percentage reduction rather than a literal subtraction from gross contract value. This preserves mathematically sound tax accounting and is recorded here as an accepted ruling reconciling the policy text.
2. **Strategic Track Four-Role Split Model (40/20/20/20)**:
   - Expand the Strategic project split from 3 roles to 4 explicit roles:
     - **Deal Owner / Opportunity Originator**: 40%
     - **Closing Salesperson**: 20%
     - **Supporting Sales Team (combined)**: 20% (split evenly among up to 2 assigned support salespeople)
     - **Sales Director**: 20%
   - Add nullable column `closing_sales_id` to `public.sales_opportunities` referencing `public.employees(id)` on delete set null.
   - Add `closing_salesperson` to `public.commission_splits` check constraint.
3. **Warn-Only Participant Policy (Superseding Hard Gates)**:
   - Missing required participants (Deal Owner, Sales Director, or Closing Salesperson on Strategic deals) will **warn only, everywhere** without hard-blocking pipeline stage transitions.
   - Non-blocking advisory warnings surface in the SOR Form/Edit modal, the SOR Details modal, pipeline stage transition toasts, and the Commission Dashboard deal ledger (with warning badges).
   - Unassigned roles leave their share explicitly **unattributed** in the commission ledger, serving as an accountability mechanism.
4. **Department Reserve Fund Position Seeds**:
   - Seed `commission_positions` with a 5% allocation for `Department Reserve Fund` under the Administration, Human Resources, and Finance & Accounting departments.
5. **Monetary Privacy Masking Deferral**:
   - Acknowledge that monetary masking in the browser remains a client-side presentation filter, not a database security boundary (under the existing single-tier auth/anon key model).
   - Amend `CONTEXT.md` to remove unsupported "security boundary" assertions and log client-side masking as an accepted interim state until backend row-level monetary policies are introduced.

## Considered Options
- **Hard Gate on Stage Transitions**: Rejected because 10 existing deals past Lead lacked assigned participants (1 missing Deal Owner, 9 missing Sales Director). A hard gate would block deal progress mid-workflow and cause user disruption.
- **Redistribution of Unfilled Shares**: Rejected in favor of explicit unattributed tracking to preserve mathematical transparency and audit accountability.
- **Reusing Support Slots for Closing Salesperson**: Rejected in favor of a dedicated `closing_sales_id` schema column to prevent role ambiguity.
