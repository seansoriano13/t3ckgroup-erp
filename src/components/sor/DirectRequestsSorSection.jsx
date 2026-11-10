import { useQuery } from "@tanstack/react-query";

import LinerList from "@/components/record/LinerList";
import SectionHeader from "../ui/SectionHeader";
import { ITEM_STATUS_LABELS, ITEM_STATUS_THEME } from "../../constants/purchaseRequest";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import StatusBadge from "../StatusBadge";

/**
 * "Direct requests for this project" on an SOR (#689): each Direct request made
 * for it, with its title, PR number, P0 and status. No money. Renders nothing when
 * there are none or the viewer may not read the SOR (the database returns nothing).
 */
export default function DirectRequestsSorSection({ opportunityId }) {
  const { data: requests = [] } = useQuery({
    queryKey: ["sor", "direct-requests", opportunityId],
    queryFn: () => purchaseRequestService.directForSor(opportunityId),
    enabled: Boolean(opportunityId),
    staleTime: 0,
  });
  if (requests.length === 0) return null;

  const rows = requests.map((request) => ({
    key: request.id,
    testId: "direct-request",
    label: request.title,
    main: request.title,
    sub: (
      <>
        <span className="font-mono">{request.prNumber}</span>
        {" · "}
        {request.p0 ? <span className="font-mono">{request.p0}</span> : "No P0 yet"}
      </>
    ),
    actions: (
      <StatusBadge
        label={ITEM_STATUS_LABELS[request.status] ?? request.status}
        theme={ITEM_STATUS_THEME[request.status]}
      />
    ),
  }));

  return (
    <section className="space-y-3" aria-label="Direct requests for this project">
      <SectionHeader title="Direct requests for this project" className="pb-2" />
      <p className="text-xs text-muted-foreground">
        Requests Purchasing is working on for this project. They are not part of its products.
      </p>
      <LinerList label="Direct requests for this project" rows={rows} empty="No Direct requests for this project." />
    </section>
  );
}
