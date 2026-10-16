# Built in #270 (commits 45853acc, 8d8e5e5e, 45ec18a9; merged into integrate/costing-matrix)

- Migration `20261018130000_costing_summary_final_acquire.sql`: costing_settings (single row: vat_divisor, tax_rate, retention_rate, itr_rate, itr_allowance; Finance access or Super Admin write; authenticated read); costing_matrix_money.marketing, opex (finance or management band; closed_book read); final_acquire seed by call_sign 101; signer lists readable by every signed-in user (Super Admin writes).
- `costing_set_money` CREATE OR REPLACEd: Finance access may write Finance-band columns without a read tier. Any later CREATE OR REPLACE of costing_set_money must keep this.
- costingMath.summary(matrix, settings) — BigInt, half-up to centavo on return; `incomplete` has missingCost, missingOffer, noTenderLines, noCostRows. Added finalAcquireTotal(rows); lineTotals/componentTotals shapes unchanged.
- Service: getSettings, setSettings, getSignerLists, setSignerList, updateMatrixMoney; summary/money/rates keys only for closed_book.
- UI: summary at grid foot with the Incomplete texts; Final Acquire MNGT column on Components and cost-only rows; settings: src/components/costing/settings/RatesSection.jsx, SignerListsSection.jsx (prop listKey), CostingMatrixSettings.jsx; Finance access sees only Rates. settingsPage.test.jsx expects the "Costing Matrix" tab after Purchasing.
- Marketing/OPEX are typed in the UI only by Final Acquire list members (Finance-only users have no read tier).
