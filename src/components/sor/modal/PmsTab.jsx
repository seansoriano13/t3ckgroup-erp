import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import PmsSections from "./PmsSections";

/**
 * PMS (#267): one SOR's purchasing file inside the SOR window. The sections are PmsSections, shared with
 * the PMS page (#1021); this adds the way out to that page.
 */
export default function PmsTab({ opportunityId, opportunity }) {
  return (
    <PmsSections
      opportunityId={opportunityId}
      opportunity={opportunity}
      headerAction={
        <Button variant="link" size="xs" asChild>
          <Link to={`/purchasing/pms/${opportunityId}`}>Open on its own page</Link>
        </Button>
      }
    />
  );
}
