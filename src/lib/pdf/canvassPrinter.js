/**
 * Printing a Canvass (issue #282, ADR 0014): the I/O around the pure pieces.
 *
 *   canvassService.get          the Canvass, as the printing reader may see it
 *   buildCanvassViewModel       what the paper says (canvassViewModel.js)
 *   hydrateCanvassSignatures    stored signatures, fetched as images
 *   buildCanvassDocument        the A4 portrait sheet (canvassDocument.js)
 *   printIntoWindow             the browser's own print dialog
 *
 * The caller opens the window in the click (`openCanvassPrintWindow`): the reads are network round
 * trips and a popup blocker only allows a window opened while the click is fresh.
 */

import { supabase } from '../supabase';
import { canvassService } from '../../services/canvassService';
import { signatureService } from '../../services/signatureService';
import { buildCanvassDocument } from './canvassDocument';
import { buildCanvassViewModel, canPrintCanvass } from './canvassViewModel';
import { blobToDataUrl, openPrintWindow, printIntoWindow } from './htmlPrinter';

/** Opens the window the Canvass will print into. Call it synchronously in the click. Null when a popup blocker refused. */
export function openCanvassPrintWindow() {
  return openPrintWindow('Canvass');
}

/**
 * Fetches each stored signature once and puts the image on the block. A block with no stored
 * signature has no path and prints the name only; one whose file can't be fetched falls back to
 * the name too, and says so.
 */
export async function hydrateCanvassSignatures(vm) {
  const blocks = vm.signatures ?? [];
  const images = new Map();

  await Promise.all(
    [...new Set(blocks.map((block) => block.signaturePath).filter(Boolean))].map(async (path) => {
      try {
        const blob = await signatureService.downloadSignature(path);
        if (blob) images.set(path, await blobToDataUrl(blob));
      } catch (error) {
        console.warn('Failed to load signature for the printed Canvass', error);
      }
    }),
  );

  for (const block of blocks) {
    if (!block.signaturePath) continue;
    const image = images.get(block.signaturePath);
    if (image) block.signatureBase64 = image;
    else block.stamp = `${block.stamp} · signature image unavailable`;
  }
  return vm;
}

/** Name and stored signature of each employee wanted, by id. */
async function readPeople(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabase.from('employees').select('id, name, signature_path').in('id', wanted);
  if (error) throw error;
  return new Map((data ?? []).map((row) => [row.id, { name: row.name, signaturePath: row.signature_path || null }]));
}

/** The SOR's reference ("S07983"), or null when there is none to read. */
async function readSorReference(opportunityId) {
  if (!opportunityId) return null;
  const { data, error } = await supabase.from('sales_opportunities').select('sales_reference').eq('id', opportunityId).maybeSingle();
  if (error) throw error;
  return data?.sales_reference ?? null;
}

/**
 * The Canvass as a view model with its signatures, ready to compose. `subject` is the service's
 * `{ componentId }` or `{ requestedItemId }`; `subjectLabel` is the panel's name for it (a
 * Component's number and name, or the Requested Item's name). Refuses for a reader without the
 * money tier: the sheet is prices.
 */
export async function prepareCanvassForPrint(subject, { subjectLabel = '', opportunityId = null, printedBy = null, now = new Date() } = {}) {
  const canvass = await canvassService.get(subject);
  if (!canvass) throw new Error("This subject has no Canvass yet, or you don't have access to it.");
  if (!canPrintCanvass(canvass)) throw new Error("Printing a Canvass shows prices, and you don't have access to them.");

  const [sor, people] = await Promise.all([
    readSorReference(opportunityId),
    readPeople([canvass.created_by, canvass.signed_off_by]),
  ]);
  const label = String(subjectLabel ?? '').trim();
  const vm = buildCanvassViewModel(
    {
      canvass,
      subject: subject.requestedItemId
        ? { sor, requestedItem: { name: label } }
        : { sor, component: { name: label } },
      people: {
        creator: people.get(canvass.created_by),
        approver: people.get(canvass.signed_off_by),
      },
    },
    { printedAt: now.toISOString(), printedBy },
  );
  return hydrateCanvassSignatures(vm);
}

/**
 * Prints one Canvass into `printWindow` (from `openCanvassPrintWindow`). Closes the window and
 * rethrows when anything fails, so no blank tab is left behind.
 */
export async function printCanvass(subject, { printWindow, subjectLabel = '', opportunityId = null, printedBy = null } = {}) {
  try {
    const vm = await prepareCanvassForPrint(subject, { subjectLabel, opportunityId, printedBy });
    await printIntoWindow(printWindow, buildCanvassDocument(vm));
  } catch (error) {
    try {
      printWindow?.close();
    } catch {
      // The window was already closed.
    }
    throw error;
  }
}
