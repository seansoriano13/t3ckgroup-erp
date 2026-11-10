import StageFieldsForm from "../sor/StageFieldsForm"
import SampleProvider from "./SampleProvider"
import { PEOPLE, SAMPLE_EMPLOYEES } from "./sampleData"

/**
 * The For admins tab's samples: the app's own components fed Sample Data.
 * Throwaway (ADR 0030, 2026-11 amendment): if one breaks, delete it.
 */

const OPPORTUNITY = { id: "sample-fields-opp", flow_stage_id: "sample-fields-stage" }
const VISIT = "sample-fields-visit"

const field = (id, label, field_type, extra = {}) => ({
  id,
  label,
  source: "custom",
  field_type,
  is_required: true,
  help: null,
  options: null,
  show_when: null,
  ...extra,
})

const FIELDS = [
  field("f-noa", "NOA Amount", "currency", { help: "From the Notice of Award." }),
  field("f-logistics", "Logistics Representative", "employee"),
  field("f-demo", "Product Demo", "choice", { options: ["Yes", "No"] }),
  field("f-demo-plan", "If yes, demo date and venue", "text", { show_when: { field_id: "f-demo", value: "Yes" } }),
  field("f-no-demo", "If no, why not", "text", { show_when: { field_id: "f-demo", value: "No" } }),
]

export function FieldTypesSample() {
  return (
    <SampleProvider
      seed={[
        [["stageFieldValues", VISIT], { "f-demo": "Yes" }],
        [["previousStageVisitId", OPPORTUNITY.id, OPPORTUNITY.flow_stage_id], null],
        [["employees"], SAMPLE_EMPLOYEES],
      ]}
    >
      <div className="max-w-xl space-y-2">
        <p className="text-sm text-muted-foreground">
          Product Demo is Yes, so &quot;If yes, demo date and venue&quot; shows. &quot;If no, why not&quot; stays hidden.
        </p>
        <StageFieldsForm opportunity={OPPORTUNITY} fields={FIELDS} currentVisitId={VISIT} actorId={PEOPLE.lara.id} />
      </div>
    </SampleProvider>
  )
}
