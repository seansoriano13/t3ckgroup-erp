import EvaluationSection from "./EvaluationSection";

/**
 * The Costing Matrix section of Settings (spec #266): one place for what the matrix reads from
 * configuration. This file starts with the Evaluation of Specification section (#271); the
 * tickets for rates, markup presets and the Final Acquire list add theirs alongside.
 */
export default function CostingMatrixSettings() {
  return (
    <div className="space-y-4" data-testid="costing-matrix-settings">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Costing Matrix</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">What the Costing Matrix reads from configuration.</p>
      </div>
      <EvaluationSection />
    </div>
  );
}
