import ProtectedRoute from "../../components/ProtectedRoute";
import TechnicalAccess from "../../components/technical/TechnicalAccess";
import TechnicalList from "../../components/technical/TechnicalList";

/**
 * The Technical list (#877, #908): the S0 Evaluations the caller is the Technical in-charge of, to give the Complies
 * or Deviates verdict, and, for the Evaluation list, the ones waiting for approval. The menu offers it to those people
 * and Super Admins; the page sends anyone else home and the database refuses the read.
 */
export default function TechnicalPage() {
  return (
    <ProtectedRoute>
      <TechnicalAccess>
        <TechnicalList />
      </TechnicalAccess>
    </ProtectedRoute>
  );
}
