import { ListPlus, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import SectionHeader from "../ui/SectionHeader";
import LinerList from "@/components/record/LinerList";
import StatusBadge from "../StatusBadge";
import {
  IPAS_DOCUMENT_APPLIES_TO_LABELS,
  IPAS_DOCUMENT_USED_FOR,
  IPAS_DOCUMENT_USED_FOR_LABELS,
  IPAS_TICK_SIDE,
  IPAS_TICK_SIDE_LABELS,
} from "../../constants/ipas";
import ReadTick from "@/components/record/ReadTick";
import { useEditable, useInDrawer } from "@/components/record/sectionChrome";
import { fileRulesOf, requiredFilesByPart } from "../../utils/ipasDocuments";
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
  onAdd,
  onSuggest,
  onRemove,
}) {
  const canChange = useEditable(changeGranted);
  const canTickFinance = useEditable(tickGranted);
  // In the drawer the two ticks read as text; the edit view keeps the boxes.
  const inDrawer = useInDrawer();
  const documents = ipas.documents ?? [];
  const suggested = ipas.suggestedDocuments ?? [];
  const required = requiredFilesByPart(documents, ipas.payments ?? [], ipas.source, fileRulesOf(ipas));

  const attach = async (document, picked) => {
    try {
      for (const file of picked) await onAttach(document, file);
    } catch (error) {
      toast.error(error?.message || "The file couldn't be attached.");
    }
  };

  return (
    <div className="mt-5 space-y-3" data-testid="ipas-documents">
      <SectionHeader title={`Documents · ${documents.length}`} className="border-b-0 pb-2">
        {canChange && (
          <>
            {suggested.length > 0 && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onSuggest}>
                <ListPlus size={14} />
                Add {suggested.length} suggested
              </Button>
            )}
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onAdd}>
              <Plus size={14} />
              Add document
            </Button>
          </>
        )}
      </SectionHeader>

      {compliance && <IpasComplianceBlock ipas={ipas} compliance={compliance} />}

      {required.length > 0 && (
        <div className="rounded-xl border border-border px-3 py-2 text-xs" data-testid="ipas-required-files">
          <p className="font-semibold text-foreground">Required files</p>
          <ul className="mt-1 space-y-0.5">
            {required.map((row) => (
              <li key={`${row.part}-${row.label}`} className="flex items-center gap-1.5">
                <span className="font-medium text-red-11" aria-hidden="true">
                  *
                </span>
                <span className="text-foreground">{row.label}</span>
                <span className="sr-only">(required)</span>
                <span className={row.missing ? "font-medium text-red-11" : "text-muted-foreground"}>
                  {row.missing ? "Missing" : "Attached"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <LinerList
        label="Documents"
        empty={`No documents on this IPAS yet.${canChange ? " Add the ones this purchase asks for." : ""}`}
        rows={documents.map((document) => ({
          key: document.id,
          testId: "ipas-document-row",
          main: document.label,
          sub: document.byHand ? (
            "Added by hand"
          ) : (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              {IPAS_DOCUMENT_APPLIES_TO_LABELS[document.appliesTo] ?? ""}
              {document.isFiling && (
                <StatusBadge
                  theme="blue"
                  label={
                    document.usedFor === IPAS_DOCUMENT_USED_FOR.FILING
                      ? "Filing item"
                      : IPAS_DOCUMENT_USED_FOR_LABELS[document.usedFor]
                  }
                />
              )}
            </span>
          ),
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
      <p className="text-xs text-muted-foreground">
        Each department ticks its own box. A filing item ticked here is already ticked at Filing.
      </p>
    </div>
  );
}
