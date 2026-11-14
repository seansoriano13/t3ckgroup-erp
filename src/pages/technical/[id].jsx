import { useNavigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";

import ProtectedRoute from "../../components/ProtectedRoute";
import ModalShell from "../../components/ui/ModalShell";
import TechnicalAccess from "../../components/technical/TechnicalAccess";
import TechnicalList from "../../components/technical/TechnicalList";
import TechnicalSheet from "../../components/technical/TechnicalSheet";
import { costingMatrixService } from "../../services/costingMatrixService";
import { technicalKeys } from "../../utils/technicalList";

/**
 * One SOR's Technical sheet in the record window, over the Technical list (the same shape as the S0 Evaluation
 * window). The URL is the SOR's id and works as a deep link, and is where the "rows are waiting" notification lands.
 * Closing returns to the list.
 */
function TechnicalWindow() {
  const { id } = useParams();
  const navigate = useNavigate();

  // The SOR's number for the window's crumb, from the same read the list uses.
  const { data: rows } = useQuery({ queryKey: technicalKeys.list, queryFn: () => costingMatrixService.technicalList(), retry: false });
  const sorNumber = rows?.find((row) => row.opportunityId === id)?.sorNumber ?? "SOR";

  return (
    <ModalShell open onOpenChange={(next) => !next && navigate("/technical")} size="record" crumbs={["Technical", sorNumber]}>
      <TechnicalSheet opportunityId={id} onBack={() => navigate("/technical")} />
    </ModalShell>
  );
}

export default function TechnicalRecordPage() {
  const { id } = useParams();
  return (
    <ProtectedRoute>
      <TechnicalAccess>
        <TechnicalList selectedId={id} />
        <TechnicalWindow />
      </TechnicalAccess>
    </ProtectedRoute>
  );
}
