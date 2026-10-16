# Built in #462 (commits 85848801, 467ec01e)

- Migration `20261018160000_open_costing_matrix_action.sql`: action kind `open_costing_matrix`; window source `costing_matrix`; sor_action_runs.costing_matrix_id (fire once).
- Runs via sor_run_stage_actions (auto) or `sor_open_costing_matrix(run)` (browser, after a Decider picks Create; reads config from the Flow Snapshot; needs edit/full access on the SOR). costing_open_matrix(opp, cfg) still service-role only; it now applies config (incharges, preset → default factor, extra members as Stage Participant windows "Added to a deal"); later runs fill only blanks / members with no open window.
- No Purchasing Incharge on creation → notification OPPORTUNITY_COSTING_INCHARGE_NEEDED to assigners.
- sor_open_purchase_request: `costing_incharge` Buyer option = matrix's Purchasing Incharge.
- Replaced in full: sor_run_stage_actions, sor_open_purchase_request, costing_open_matrix — later CREATE OR REPLACE of these must keep this.
- UI: OpenCostingMatrixActionModal (Flow Canvas), Add Action menu, detail panel, published versions; Optional Action decider card; system note STAGE_ACTION_COSTING_MATRIX_OPENED. Test double handles open_costing_matrix and sor_open_costing_matrix; src/services/openCostingMatrix.test.js.
- Known gap: preset picker in the modal is empty for anyone not Super Admin / Final Acquire list.
- For #463's publish warning: a stage "mounts" the matrix if it has an `open_costing_matrix` flow_stage_action.
