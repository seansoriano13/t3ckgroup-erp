import MarkupPresetsSection from "./MarkupPresetsSection";

/**
 * The Costing Matrix tab of the Purchasing settings (#269). It is only a list of standalone sections, each
 * one a component that loads and saves its own data, so a ticket adds its section as one line below
 * without touching the others: Markup presets (#269); the tax and ITR rates (#270) and the evaluation
 * lists (#271) join here.
 */
const SECTIONS = [
  { key: "markup-presets", Section: MarkupPresetsSection },
];

export default function CostingMatrixSettings() {
  return (
    <div className="space-y-8" data-testid="costing-matrix-settings">
      {SECTIONS.map(({ key, Section }) => (
        <Section key={key} />
      ))}
    </div>
  );
}
