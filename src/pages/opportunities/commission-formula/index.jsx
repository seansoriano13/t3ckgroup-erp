import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import PageHeader from "../../../components/ui/PageHeader";
import PageContainer from "../../../components/ui/PageContainer";
import CommissionFormulaView from "../../../components/sor/CommissionFormulaView.jsx";

export default function CommissionFormulaPage() {
  return (
    <ProtectedRoute>
      <PageContainer maxWidth="2xl" className="pt-4">
        <PageHeader
          title="Commission Formula"
          description="Current Commission Rates and Department allocation, and the Sales role split for Single Salesperson, Collaborative, and Strategic projects."
        />

        <CommissionFormulaView />
      </PageContainer>
    </ProtectedRoute>
  );
}
