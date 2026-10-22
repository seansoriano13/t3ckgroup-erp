// Print preview: the IPAS as it prints, without leaving the page. The frame
// holds the very document Print sends to the browser (the same view model, the
// same composer, the same stylesheet), built from the IPAS on screen, so what
// is seen here is what comes out of the printer. Printing from the preview
// prints that frame. The grey desk and the page shadows are screen only; they
// never reach the paper.

import { useEffect, useRef, useState } from "react";
import { Eye, FileLock2, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import Spinner from "@/components/ui/Spinner";
import { buildIpasDocument } from "@/lib/pdf/ipasDocument";
import { hydrateIpasSignatures } from "@/lib/pdf/ipasPrinter";
import { buildIpasViewModel } from "@/lib/pdf/ipasViewModel";

// The desk and the sheet's lift are the `--preview-desk` and `--preview-sheet-shadow`
// tokens (index.css). The frame is its own document with no app CSS, so the
// token values are read here and written into it.
function deskStyle() {
  const root = getComputedStyle(document.documentElement);
  const desk = root.getPropertyValue("--preview-desk").trim();
  const lift = root.getPropertyValue("--preview-sheet-shadow").trim();
  return `<style>@media screen {
  html, body { background: ${desk}; }
  body { padding: 24px 0 4px; }
  .sheet { margin: 0 auto 24px; box-shadow: ${lift}; }
}</style>`;
}

function PreviewFrame({ ctx, filingCopy, frame }) {
  const { ipas, refresh, printedBy } = ctx;
  const [html, setHtml] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const vm = buildIpasViewModel({ ...ipas, refresh: refresh ?? null }, { filingCopy, printedAt: new Date().toISOString(), printedBy });
        await hydrateIpasSignatures(vm);
        if (live) setHtml(buildIpasDocument(vm).replace("</head>", `${deskStyle()}</head>`));
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [ipas, refresh, printedBy, filingCopy]);

  if (failed) {
    return <p className="p-10 text-center text-sm text-muted-foreground">The preview couldn&apos;t be prepared. Print still works.</p>;
  }
  if (!html) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner text="Preparing the preview…" />
      </div>
    );
  }
  return <iframe ref={frame} title={`Print preview of ${ipas.number}`} srcDoc={html} className="h-full w-full border-0" />;
}

/** The header's Preview button, and the dialog it opens. */
export function PrintPreviewButton({ ctx }) {
  const [open, setOpen] = useState(false);
  const [filingCopy, setFilingCopy] = useState(false);
  const frame = useRef(null);
  const { ipas, can } = ctx;

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Eye size={14} />
        Preview
      </Button>

      <ModalShell
        open={open}
        onOpenChange={setOpen}
        size="wide"
        expandable
        className="h-[90vh]"
        bodyClassName="gap-0 p-0"
        crumbs={["IPAS", ipas.number, "Print preview"]}
        headerActions={
          can.printFiling && (
            <Button
              size="sm"
              variant={filingCopy ? "secondary" : "ghost"}
              aria-pressed={filingCopy}
              className="h-auto gap-1.5 px-2 py-1.5 text-xs"
              onClick={() => setFilingCopy(!filingCopy)}
            >
              <FileLock2 size={14} />
              Filing copy
            </Button>
          )
        }
        cancelLabel="Close"
        actions={
          <Button size="lg" className="gap-1.5" onClick={() => frame.current?.contentWindow?.print()}>
            <Printer size={16} />
            Print this
          </Button>
        }
      >
        <p className="border-b border-border px-5 py-2 text-xs text-muted-foreground">
          <span className="font-mono">{ipas.number}</span> exactly as it prints: two A4 pages.
        </p>
        <div className="min-h-0 flex-1 bg-mauve-4">
          {open && <PreviewFrame key={String(filingCopy)} ctx={ctx} filingCopy={filingCopy} frame={frame} />}
        </div>
      </ModalShell>
    </>
  );
}
