/**
 * Printing a Costing Matrix (issue #274, ADR 0014): the I/O around the pure pieces.
 *
 *   costingMatrixService.get       the matrix, as the printing tier may read it
 *   buildCostingMatrixViewModel    what the paper says (costingMatrixViewModel.js)
 *   hydrateCostingMatrixSignatures stored signatures, fetched as images
 *   buildCostingMatrixDocument     the landscape A4 sheets (costingMatrixDocument.js)
 *   printIntoWindow                the browser's own print dialog
 *
 * The caller opens the window in the click (`openCostingMatrixPrintWindow`): the reads are network
 * round trips and a popup blocker only allows a window opened while the click is fresh.
 */

import { costingMatrixService } from '../../services/costingMatrixService';
import { employeeService } from '../../services/employeeService';
import { signatureService } from '../../services/signatureService';
import { buildCostingMatrixDocument } from './costingMatrixDocument';
import { buildCostingMatrixViewModel } from './costingMatrixViewModel';
import { blobToDataUrl, openPrintWindow, printIntoWindow } from './htmlPrinter';

/** Opens the window the matrix will print into. Call it synchronously in the click. Null when a popup blocker refused. */
export function openCostingMatrixPrintWindow() {
  return openPrintWindow('S0 Evaluation');
}

/**
 * Fetches each stored signature once and puts the image on the box. A box with no stored signature,
 * or that declined, has no path and prints the name only; one whose file can't be fetched falls back
 * to the name too, and says so.
 */
export async function hydrateCostingMatrixSignatures(vm) {
  const boxes = vm.money?.signoffs ?? [];
  const images = new Map();

  await Promise.all(
    [...new Set(boxes.map((box) => box.signaturePath).filter(Boolean))].map(async (path) => {
      try {
        const blob = await signatureService.downloadSignature(path);
        if (blob) images.set(path, await blobToDataUrl(blob));
      } catch (error) {
        console.warn('Failed to load signature for the printed S0 Evaluation', error);
      }
    }),
  );

  for (const box of boxes) {
    if (!box.signaturePath) continue;
    const image = images.get(box.signaturePath);
    if (image) box.signatureBase64 = image;
    else box.stamp = `${box.stamp} · signature image unavailable`;
  }
  return vm;
}

/** Who the paper names: the incharges, the signers and the decider, by employee id. */
function peopleOf(matrix, employees) {
  const wanted = new Set(
    [
      matrix.matrix?.sales_incharge_id,
      matrix.matrix?.purchasing_incharge_id,
      matrix.bidDecision?.decidedBy,
      ...Object.values(matrix.signoffs ?? {}).map((state) => state.signoff?.signed_by),
    ].filter(Boolean),
  );
  return Object.fromEntries(employees.filter((e) => wanted.has(e.id)).map((e) => [e.id, { name: e.name }]));
}

/**
 * The matrix as a view model with its signatures, ready to compose. `opportunity` is the SOR row
 * (`sales_reference`, `project_title`, `client_name`).
 */
export async function prepareCostingMatrixForPrint(opportunityId, { opportunity = {}, printedBy = null, now = new Date() } = {}) {
  const matrix = await costingMatrixService.get(opportunityId);
  if (!matrix) throw new Error("This SOR has no S0 Evaluation yet, or you don't have access to it.");
  const employees = await employeeService.getAllEmployees();
  const vm = buildCostingMatrixViewModel(
    { matrix, opportunity, people: peopleOf(matrix, employees) },
    { printedAt: now.toISOString(), printedBy },
  );
  return hydrateCostingMatrixSignatures(vm);
}

/**
 * Prints one SOR's Costing Matrix into `printWindow` (from `openCostingMatrixPrintWindow`). Closes
 * the window and rethrows when anything fails, so no blank tab is left behind.
 */
export async function printCostingMatrix(opportunityId, { printWindow, opportunity = {}, printedBy = null } = {}) {
  try {
    const vm = await prepareCostingMatrixForPrint(opportunityId, { opportunity, printedBy });
    await printIntoWindow(printWindow, buildCostingMatrixDocument(vm));
  } catch (error) {
    try {
      printWindow?.close();
    } catch {
      // The window was already closed.
    }
    throw error;
  }
}
