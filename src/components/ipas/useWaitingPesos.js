import { useQuery } from "@tanstack/react-query";

import { ipasService } from "../../services/ipasService";
import { ipasWaitingPesosKey } from "./ipasKeys";

/** The foreign payments whose pesos are still blank, read when a filing question opens (#1124). */
export function useWaitingPesos(ipasId, enabled = true) {
  const waiting = useQuery({
    queryKey: ipasWaitingPesosKey(ipasId),
    queryFn: () => ipasService.paymentsWaitingForPesos(ipasId),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const payments = waiting.data ?? [];
  return { payments, isLoading: enabled && waiting.isLoading, blocked: payments.length > 0 };
}
