import { Navigate, useNavigate, useParams } from "react-router";

import ProtectedRoute from "../../../components/ProtectedRoute";
import OpexList from "../../../components/opex/OpexList";
import OpexReportWindow from "../../../components/opex/OpexReportWindow";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { normalizeS0 } from "../../../utils/opexReport";

/**
 * One OPEX Report (#1244, #1245, spec #1241): the record window over the OPEX list, like an
 * IPAS over its list. The address names the S0 and works as a link; closing returns to the list.
 */
export default function OpexReportPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { s0: param } = useParams();
  const { isSuperAdmin, hasFinanceFlow } = getPermissionContext(user);
  if (user && !(isSuperAdmin || hasFinanceFlow)) return <Navigate to="/" replace />;
  const s0 = normalizeS0(param);
  if (!s0) return <Navigate to="/finance/opex" replace />;
  return (
    <ProtectedRoute>
      <OpexList openS0={s0}>
        <OpexReportWindow key={s0} s0={s0} onClose={() => navigate("/finance/opex")} />
      </OpexList>
    </ProtectedRoute>
  );
}
