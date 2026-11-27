import { Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import SectionHeader from "../ui/SectionHeader";
import LinerList from "@/components/record/LinerList";
import {
  IPAS_DOCUMENT_APPLIES_TO_LABELS,
  IPAS_TICK_SIDE,
  IPAS_TICK_SIDE_LABELS,
} from "../../constants/ipas";
import ReadTick from "@/components/record/ReadTick";
import { useEditable, useInDrawer } from "@/components/record/sectionChrome";
import { fileRulesOf, requiredKindsByPart } from "../../utils/ipasDocuments";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { DocumentFiles } from "./DocumentFiles";
import IpasComplianceBlock from "./record/IpasComplianceBlock";

/**
 * Section 3's documents (#246): one list, two ticks per row. Purchasing has it
 * belongs to Purchasing and Finance has it to Finance; neither ticks for the
 * other (the database refuses it, and the page only offers each person their own).
 *
 *   compliance      the Compliance Requirement view (moves.js `complianceFor`), or null
 *   canChange       Purchasing on an open IPAS: adds, attaches and removes rows,
 *                   and ticks Purchasing has it
 *   canTickFinance  Finance access on an open IPAS: ticks Finance has it
 *
 * The rows are the kinds matching the IPAS's Source plus whatever was added by
 * hand. Filing items (a filing kind such as BIR 2307) are the same rows: section
 * 7's checklist reads them.
 */
export function IpasDocuments({
  ipas,
  compliance = null,
  canChange: changeGranted = false,
  canTickFinance: tickGranted = false,
  onTick,
  onAttach,
  onRemoveAttachment,
  onRemove,
}) {
  const canChange = useEditable(changeGranted);
  const canTickFinance = useEditable(tickGranted);
  // In the drawer the two ticks read as text; the edit view keeps the boxes.
  const inDrawer = useInDrawer();
  const documents = ipas.documents ?? [];
  const suggested = ipas.suggestedDocuments ?? [];
  // The kinds a sign-off waits on for this Source get a red asterisk, as in the edit view.
  const requiredKindIds = new Set(Object.values(requiredKindsByPart(fileRulesOf(ipas), ipas.source)).flat().map((kind) => kind.id));
  const requiredIds = new Set(documents.filter((d) => !d.byHand && requiredKindIds.has(d.kind_id)).map((d) => d.id));

  const attach = async (document, picked) => {
    try {
      for (const file of picked) await onAttach(document, file);
    } catch (error) {
      toast.error(error?.message || "The file couldn't be attached.");
    }
  };

  return (
    <div className="mt-5 space-y-3" data-testid="ipas-documents">
      <SectionHeader title={`Documents · ${documents.length}`} className="border-b-0 pb-2" />

      {compliance && <IpasComplianceBlock ipas={ipas} compliance={compliance} />}

      <LinerList
        label="Documents"
        empty="No documents on this IPAS yet."
        rows={documents.map((document) => ({
          key: document.id,
          testId: "ipas-document-row",
          main: (
            <>
              {document.label}
              {requiredIds.has(document.id) && (
                <>
                  <RequiredMark />
                  <span className="sr-only"> (required)</span>
                </>
              )}
            </>
          ),
          sub: document.byHand ? "Added by hand" : (IPAS_DOCUMENT_APPLIES_TO_LABELS[document.appliesTo] ?? ""),
          subWrap: true,
          actions: (
            <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
              <DocumentFiles
                label={document.label}
                files={document.files}
                canChange={canChange}
                missing={!document.hasFile}
                onAdd={(picked) => attach(document, picked)}
                onRemove={(file) => onRemoveAttachment(document, file)}
              />
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                {IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.PURCHASING]}
                {inDrawer ? (
                  <ReadTick
                    checked={document.purchasingHas}
                    label={`${IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.PURCHASING]}: ${document.label}`}
                  />
                ) : (
                  <Checkbox
                    tone="neutral"
                    checked={document.purchasingHas}
                    disabled={!canChange}
                    aria-label={`${IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.PURCHASING]}: ${document.label}`}
                    onCheckedChange={(value) => onTick(document, IPAS_TICK_SIDE.PURCHASING, Boolean(value))}
                  />
                )}
              </span>
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                {IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.FINANCE]}
                {inDrawer ? (
                  <ReadTick
                    checked={document.financeHas}
                    label={`${IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.FINANCE]}: ${document.label}`}
                  />
                ) : (
                  <Checkbox
                    tone="neutral"
                    checked={document.financeHas}
                    disabled={!canTickFinance}
                    aria-label={`${IPAS_TICK_SIDE_LABELS[IPAS_TICK_SIDE.FINANCE]}: ${document.label}`}
                    onCheckedChange={(value) => onTick(document, IPAS_TICK_SIDE.FINANCE, Boolean(value))}
                  />
                )}
              </span>
              {/* Only a document added by hand can be removed; a suggested one is ticked or left. */}
              {canChange && document.byHand && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-red-11"
                  aria-label={`Remove ${document.label}`}
                  onClick={() => onRemove(document)}
                >
                  <Trash2 />
                </Button>
              )}
            </span>
          ),
        }))}
      />
    </div>
  );
}
