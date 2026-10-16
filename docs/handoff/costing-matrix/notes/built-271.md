# Built in #271 (commits e51e165e, 9d7d6e19, a5a749d9)

- Migration `20261018140000_costing_matrix_evaluation.sql`: costing_components.compliance / compliance_note (CHECK note when deviates) / recommended_alternative (technical band, all tiers read); costing_is_technical widened (Purchasing access or current member of a non-cancelled group task on the SOR from the evaluation template); costing_evaluation_settings (single row, evaluation_template_id; Super Admin writes); evaluation list seed call_sign 1001.
- costing_signoffs (matrix_id, role in prepared/costed/evaluation_approved/final_approved, signed_by, signed_at, signature_declined, cleared_at, cleared_reason; live = uncleared), registered in costing_tables — costing_matrix_read serves it to every tier. Guard trigger `costing_signoffs_guard`.
- `costing_sign(matrix, role, p_decline_signature default false)`: only evaluation_approved implemented (evaluation list + some read tier; every Component has a verdict; zero Components allowed); other roles raise "not yet available". `costing_clear_signoffs(matrix, roles[], reason)` — call it from triggers for other roles.
- Service: setCompliance(componentId, {verdict, note, alternative}), sign(matrixId, role), signoffState (exported); shapeMatrix returns `compliance` per line and matrix and `evaluation: {approved, signoff, cleared}`.
- costingMath: complianceRollup, describeComplianceRollup.
- Constants/UI: COMPONENT_BANDS + compliance columns; COMPLIANCE_LABEL / COMPLIANCE_THEME; ComplianceCell, EvaluationBar, BandHeader tone `tech`; costingKeys.evaluationList. Settings: costingEvaluationSettingsService, EvaluationSection.
- Test helpers: stubCostingMatrixRpcs takes actorId, onEvaluationList; src/test/db/triggers.js mirrors clearing triggers and the deviation-note check.
