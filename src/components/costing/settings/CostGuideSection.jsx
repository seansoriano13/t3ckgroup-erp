import { useQuery, useQueryClient } from "@tanstack/react-query";

import PageLoading from "../../ui/PageLoading";
import QueryError from "../../ui/QueryError";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { costingKeys } from "../costingKeys";
import { Cell } from "../GridCell";

/**
 * The cost guide (#723): the sheet's cost categories with the low and high % each should take of the Final
 * Offer (Products 70 to 80, Labor 8 to 15, and so on). The S0 Evaluation shows each deal's real share beside
 * these. Super Admins change a range; the database refuses everyone else. The categories themselves are fixed.
 */
export default function CostGuideSection({ canEdit = true }) {
  const queryClient = useQueryClient();
  const { data: categories = [], isLoading, isError, refetch } = useQuery({
    queryKey: costingKeys.costCategories(),
    queryFn: () => costingMatrixService.listCostCategories(),
    retry: false,
  });

  const save = async (category, fields) => {
    await costingMatrixService.saveCostCategory({ key: category.key, lowPct: category.lowPct, highPct: category.highPct, ...fields });
    await queryClient.invalidateQueries({ queryKey: costingKeys.costCategories() });
    // A changed range changes every open guide.
    await queryClient.invalidateQueries({ queryKey: ["costing"], predicate: (q) => q.queryKey[2] === "costGuide" });
  };

  return (
    <section className="space-y-4" aria-label="Cost guide" data-testid="cost-guide-settings">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Cost guide</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The share of the Final Offer each cost category should take, from the project sheet. The S0 Evaluation shows a deal&apos;s real split beside
          these and warns when a share is outside its range. It never blocks a deal.
        </p>
      </div>

      {isLoading ? (
        <PageLoading label="cost guide" />
      ) : isError ? (
        <QueryError title="The cost guide could not be loaded." onRetry={refetch} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {categories.map((category) => (
            <li key={category.key} data-testid="cost-guide-category" className="flex flex-wrap items-start gap-3 px-4 py-2.5">
              <p className="min-w-[12rem] flex-1 pt-1.5 text-sm text-foreground">{category.label}</p>
              <div className="w-28">
                <Cell
                  label={`${category.label}: low %`}
                  noun="Low %"
                  value={category.lowPct}
                  numeric
                  step="0.01"
                  align="right"
                  readOnly={!canEdit}
                  onSave={(value) => save(category, { lowPct: value })}
                />
              </div>
              <div className="w-28">
                <Cell
                  label={`${category.label}: high %`}
                  noun="High %"
                  value={category.highPct}
                  numeric
                  step="0.01"
                  align="right"
                  readOnly={!canEdit}
                  onSave={(value) => save(category, { highPct: value })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
