import ProtectedRoute from "../../components/ProtectedRoute";
import TeamsOnly from "../../components/technical/TeamsOnly";
import TechnicalList from "../../components/technical/TechnicalList";

/**
 * The Technical list (#877): the SORs with S0 Evaluation rows given to the caller's team (RRD or IOE), for
 * answering Complies or Deviates. The menu offers it to the teams' members and Super Admins; the page sends anyone
 * else home and the database refuses the read.
 */
export default function TechnicalPage() {
  return (
    <ProtectedRoute>
      <TeamsOnly>
        <TechnicalList />
      </TeamsOnly>
    </ProtectedRoute>
  );
}
