import { useState } from "react";
import { ListPlus, Paperclip, Plus, Trash2, X } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { ExternalLink } from "../ui/external-link";
import { FileInput } from "../ui/FileInput";
import SectionHeader from "../ui/SectionHeader";
import Spinner from "../ui/Spinner";
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
import { ALLOWED_EXTENSIONS_STRING } from "../../utils/attachments";
import { uploadDocumentFile } from "./uploadDocumentFile";

/**
 * Section 3's documents (#246): one list, two ticks per row. Purchasing has it
 * belongs to Purchasing and Finance has it to Finance; neither ticks for the
 * other (the database refuses it, and the page only offers each person their own).
 *
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
  const [uploadingId, setUploadingId] = useState(null);

  const attach = async (document, [file]) => {
    setUploadingId(document.id);
    try {
      const url = await uploadDocumentFile(file);
      if (url) await onAttach(document, url);
    } catch (error) {
      toast.error(error?.message || "The file couldn't be attached.");
    } finally {
      setUploadingId(null);
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
              {document.attachmentUrl ? (
                <span className="inline-flex items-center gap-1.5">
                  <ExternalLink
                    href={document.attachmentUrl}
                    className="inline-flex items-center gap-1 font-medium text-foreground underline underline-offset-2"
                  >
                    <Paperclip size={12} aria-hidden="true" />
                    View
                  </ExternalLink>
                  {canChange && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground"
                      aria-label={`Remove the attachment of ${document.label}`}
                      onClick={() => onRemoveAttachment(document)}
                    >
                      <X />
                    </Button>
                  )}
                </span>
              ) : canChange ? (
                <FileInput
                  accept={ALLOWED_EXTENSIONS_STRING}
                  disabled={uploadingId === document.id}
                  onFiles={(files) => attach(document, files)}
                  size="xs"
                  className="gap-1"
                  aria-label={`Attach a file to ${document.label}`}
                >
                  {uploadingId === document.id ? <Spinner size="sm" /> : <Paperclip size={12} aria-hidden="true" />}
                  {uploadingId === document.id ? "Uploading…" : "Attach"}
                </FileInput>
              ) : (
                <span className="text-muted-foreground">No attachment</span>
              )}
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
