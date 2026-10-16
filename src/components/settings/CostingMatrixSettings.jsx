import RatesSection from "../costing/settings/RatesSection";
import SignerListsSection from "../costing/settings/SignerListsSection";
import { COSTING_SIGNER_LIST } from "../../constants/costing";

/**
 * The Costing Matrix section of Settings (#270, spec #266). Rates are changed by Finance access
 * and Super Admins; the Final Acquire list (who writes Final Acquire, reads the summary and sets
 * the markup factor) by Super Admins only. Someone with Finance access and nothing more sees the
 * Rates and nothing else. The Settings page offers this tab to Super Admins and Finance access;
 * the database refuses everyone else's write.
 */
export default function CostingMatrixSettings({ isSuperAdmin = false, hasFinanceAccess = false }) {
  const canEditRates = isSuperAdmin || hasFinanceAccess;
  return (
    <div className="space-y-4" data-testid="costing-matrix-settings">
      <div>
        <h2 className="text-sm font-semibold text-foreground">Costing Matrix</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">The rates behind the summary, and the people who set Final Acquire.</p>
      </div>
      <RatesSection canEdit={canEditRates} />
      {isSuperAdmin && (
        <SignerListsSection
          listKey={COSTING_SIGNER_LIST.FINAL_ACQUIRE}
          canEdit
          description="Writes Final Acquire and the markup factor, and reads the summary and the margin. A Super Admin is not on it unless added here. Changing the list never changes figures already typed."
        />
      )}
    </div>
  );
}
