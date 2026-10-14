import { Link, useNavigate } from "react-router";
import { ArrowLeft } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import { Button } from "../../../components/ui/button";
import TransmittalForm from "../../../components/transmittals/TransmittalForm";

/**
 * Raises a Transmittal (#252): a draft slip, submitted from here or later. The
 * database decides who may raise one (Purchasing access, or the Warehouse or
 * Logistics list).
 */
function NewTransmittal() {
  const navigate = useNavigate();
  return (
    <PageShell
      title="Raise a Transmittal"
      description="Tick the slip as on paper, then add the lines. Submit to open its first stage."
      action={
        <Button variant="outline" size="sm" asChild className="gap-1.5">
          <Link to="/purchasing/transmittals">
            <ArrowLeft size={14} />
            Transmittals
          </Link>
        </Button>
      }
    >
      <TransmittalForm
        onSaved={(id) => navigate(`/purchasing/transmittals/${id}`)}
        onCancel={() => navigate("/purchasing/transmittals")}
      />
    </PageShell>
  );
}

export default function NewTransmittalPage() {
  return (
    <ProtectedRoute>
      <NewTransmittal />
    </ProtectedRoute>
  );
}
