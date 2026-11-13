import { costingMatrixService } from "../../../../services/costingMatrixService";

/**
 * What the price corridor's boxes save, each through the service call the Costing Desk already uses, then a
 * refresh. A refusal (a band, the Go lock) is thrown back to the box that saved, which shows it under itself.
 */
export function corridorSaves(matrix, writes) {
  const matrixId = matrix?.matrixId;
  const after = async (call) => {
    await call;
    await writes.refresh();
  };
  return {
    line: (lineId, fields) => after(costingMatrixService.updateTenderLine(lineId, fields)),
    part: (partId, fields) => after(costingMatrixService.updateComponent(partId, fields)),
    costRow: (rowId, fields) => after(costingMatrixService.updateCostRow(rowId, fields)),
    // A usual cost category with no row yet: typing its amount, or its percent of the ABC, makes the row (#963).
    addCostRow: async ({ categoryKey, description, acquireUnit, abcPct }) => {
      const id = await costingMatrixService.addCostRow(matrixId, { categoryKey, description, quantity: 1, ...(acquireUnit !== undefined ? { acquireUnit } : {}) });
      if (abcPct !== undefined && id) await costingMatrixService.updateCostRow(id, { abcPct });
      await writes.refresh();
    },
    marketing: (value) => after(costingMatrixService.updateMatrixMoney(matrixId, { marketing: value })),
    // A switch (mode only) has no box to show a refusal under, so it goes through writes.run and its notice;
    // a typed total throws back to its box like every other value.
    abc: (patch) => ("total" in patch ? after(costingMatrixService.setAbc(matrixId, patch)) : writes.run(() => costingMatrixService.setAbc(matrixId, patch))),
    offer: (patch) => ("total" in patch ? after(costingMatrixService.setOffer(matrixId, patch)) : writes.run(() => costingMatrixService.setOffer(matrixId, patch))),
    defaultFactor: (value) => after(costingMatrixService.setDefaultMarkup(matrixId, { factor: value === "" || value == null ? null : value })),
  };
}
