/**
 * Printing a Canvass (spec #956, issue #971): the I/O around the pure pieces.
 *
 *   canvassService.get          the Canvass of the request, as the printing reader may see it
 *   buildCanvassViewModel       what the paper says (canvassViewModel.js)
 *   hydrateCanvassSignatures    the Canvasser's stored signature, fetched as an image
 *   buildCanvassDocument        the landscape A4 sheets (canvassDocument.js)
 *   printIntoWindow             the browser's own print dialog
 *
 * The caller opens the window in the click (`openCanvassPrintWindow`): the reads are network round
 * trips and a popup blocker only allows a window opened while the click is fresh.
 */

import { supabase } from '../supabase';
import { canvassService } from '../../services/canvassService';
import { signatureService } from '../../services/signatureService';
import { buildCanvassDocument } from './canvassDocument';
import { buildCanvassViewModel } from './canvassViewModel';
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

async function readOrThrow(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * The request as the sheet names it, its lines in order (a cancelled line is left off), and the
 * Canvasser. The brand asked for comes from the Component a line names.
 */
async function readRequest(canvass) {
  const request = await readOrThrow(
    supabase.from('purchase_requests').select('id, pr_number, title, opportunity_id, for_opportunity_id').eq('id', canvass.request_id).maybeSingle(),
  );
  const opportunityId = request?.for_opportunity_id ?? request?.opportunity_id ?? null;
  const [opportunity, items, canvasser] = await Promise.all([
    opportunityId
      ? readOrThrow(supabase.from('sales_opportunities').select('client_name, project_title, sales_reference').eq('id', opportunityId).maybeSingle())
      : null,
    readOrThrow(
      supabase
        .from('purchase_request_items')
        .select('id, name, description, unit, quantity, status, component_id, created_at')
        .eq('request_id', canvass.request_id)
        .order('created_at', { ascending: true }),
    ),
    (async () => {
      const id = canvass.canvasser_id ?? canvass.created_by;
      if (!id) return null;
      const row = await readOrThrow(supabase.from('employees').select('name, signature_path').eq('id', id).maybeSingle());
      return row ? { name: row.name, signaturePath: row.signature_path || null } : null;
    })(),
  ]);

  const kept = (items ?? []).filter((item) => item.status !== 'cancelled');
  const componentIds = [...new Set(kept.map((item) => item.component_id).filter(Boolean))];
  const components = componentIds.length
    ? await readOrThrow(supabase.from('costing_components').select('id, brand').in('id', componentIds))
    : [];
  const brandOf = new Map((components ?? []).map((c) => [c.id, c.brand]));

  return {
    request: {
      number: request?.pr_number ?? null,
      title: request?.title ?? null,
      client: opportunity?.client_name ?? null,
      project: opportunity?.project_title ?? null,
      sor: opportunity?.sales_reference ?? null,
    },
    lines: kept.map((item) => ({ ...item, brand: brandOf.get(item.component_id) ?? null })),
    canvasser,
  };
}

/**
 * The request's Canvass as a view model with its signature, ready to compose. `subject` is the
 * service's `{ requestId }` or `{ canvassId }`. A reader without the money tier gets the sheet
 * without prices, rates and totals (the service leaves those keys off).
 */
export async function prepareCanvassForPrint(subject, { printedBy = null, now = new Date() } = {}) {
  const canvass = await canvassService.get(subject);
  if (!canvass) throw new Error("This request has no Canvass yet, or you don't have access to it.");

  const { request, lines, canvasser } = await readRequest(canvass);
  const vm = buildCanvassViewModel(
    { canvass, request, lines, people: { creator: canvasser } },
    { printedAt: now.toISOString(), printedBy },
  );
  return hydrateCanvassSignatures(vm);
}

/**
 * Prints one Canvass into `printWindow` (from `openCanvassPrintWindow`). Closes the window and
 * rethrows when anything fails, so no blank tab is left behind.
 */
export async function printCanvass(subject, { printWindow, printedBy = null } = {}) {
  try {
    const vm = await prepareCanvassForPrint(subject, { printedBy });
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
