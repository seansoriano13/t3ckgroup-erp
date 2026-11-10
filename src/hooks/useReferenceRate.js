import { useQuery } from "@tanstack/react-query";
import { referenceRateService } from "../services/referenceRateService";

export const referenceRateKeys = {
  all: ["reference-rates"],
  day: (currency, onDate) => ["reference-rates", "day", String(currency || "").toUpperCase(), onDate],
  recent: () => ["reference-rates", "recent"],
};

/** The Reference Rate for `currency` on `onDate` (or the last good one before it). Null for PHP or no rate. */
export function useReferenceRate(currency, onDate, { enabled = true } = {}) {
  const code = String(currency || "").toUpperCase();
  return useQuery({
    queryKey: referenceRateKeys.day(code, onDate),
    queryFn: () => referenceRateService.forDay(code, onDate),
    enabled: enabled && Boolean(code) && code !== "PHP" && Boolean(onDate),
    staleTime: 10 * 60 * 1000,
  });
}
