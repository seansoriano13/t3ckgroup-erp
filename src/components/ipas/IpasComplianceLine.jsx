// The Compliance Requirements line (#1257, spec #1247): shared by the IPAS window and the SOR's IPAS summary.
// A done kind shows a tick; hovering it says the day (and the note, unless `withNote` is false). Not standing text.

import { Tooltip } from "@/components/ui/Tooltip";
import { COMPLIANCE_LABEL, doneHover } from "@/utils/ipasCompliance";

export default function IpasComplianceLine({ view, withNote = true, className = "text-xs", testId = "ipas-compliance-line" }) {
  if (!view) return null;
  return (
    <p className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${className}`} data-testid={testId}>
      <span className="font-semibold text-muted-foreground">{COMPLIANCE_LABEL}</span>
      {view.state === "unanswered" && <span className="text-muted-foreground">Not answered yet</span>}
      {view.state === "none" && <span className="text-muted-foreground">None needed</span>}
      {view.state === "kinds" &&
        view.kinds.map((kind) =>
          kind.doneOn ? (
            <Tooltip key={kind.id} content={doneHover(kind, { withNote })}>
              <span tabIndex={0} className="font-medium text-foreground" data-testid="ipas-compliance-kind-done">
                {kind.label} <span aria-label="done">✓</span>
              </span>
            </Tooltip>
          ) : (
            <span key={kind.id} className="text-foreground" data-testid="ipas-compliance-kind-open">
              {kind.label} <span className="text-muted-foreground">open</span>
            </span>
          ),
        )}
    </p>
  );
}
