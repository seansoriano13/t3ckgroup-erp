import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { ipasNextNumberKey } from "@/components/ipas/ipasKeys";
import { ipasService } from "@/services/ipasService";
import { ipasErrorMessage } from "@/utils/ipas";

/** What a Super Admin types: "123" or "TGIPAS_123". Returns the digits, or "" when it isn't a number. */
function typedNumber(text) {
  const match = /^(?:TGIPAS_)?(\d+)$/i.exec(text.trim());
  return match ? match[1] : "";
}

/**
 * The next IPAS number (#600, spec #595), in Settings > Purchasing. Everyone who
 * can open the tab sees the number the next IPAS will take; only Super Admins get
 * the field to change it, so the ERP can carry on from the sheet's real last
 * number on go-live day. The database decides: it refuses anyone else, and any
 * number at or below the highest already given (cancelled ones included).
 */
export default function NextIpasNumber({ isSuperAdmin = false }) {
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();
  const next = useQuery({
    queryKey: ipasNextNumberKey,
    queryFn: () => ipasService.nextNumber(),
  });

  const save = useMutation({
    mutationFn: (digits) => ipasService.setNextNumber(digits),
    onSuccess: (done) => {
      toast.success(`The next IPAS is ${done.number_format}.`);
      setValue("");
      queryClient.invalidateQueries({ queryKey: ipasNextNumberKey });
    },
    onError: (error) => {
      toast.error(ipasErrorMessage(error));
      queryClient.invalidateQueries({ queryKey: ipasNextNumberKey });
    },
  });

  const digits = typedNumber(value);
  const highest = next.data?.highest_given ?? 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="next-ipas-number">
      <h3 className="text-sm font-semibold text-foreground">Next IPAS number</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The number the next IPAS takes. Numbers are never reused, so it can only move up, past the highest number
        already given (cancelled IPAS included).
      </p>
      <p className="mt-3 text-sm text-foreground" data-testid="next-ipas-number-current">
        {next.isPending ? (
          "Loading..."
        ) : next.isError ? (
          "The next number could not be read."
        ) : (
          <>
            Next IPAS: <span className="font-semibold">{next.data.number_format}</span>
          </>
        )}
      </p>
      {isSuperAdmin && next.data && (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (digits) save.mutate(digits);
          }}
        >
          <FieldBox label="Set next number" bare className="w-48">
            <Input
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`above ${highest}, e.g. ${highest + 1}`}
            />
          </FieldBox>
          <Button type="submit" variant="outline" disabled={save.isPending || !digits}>
            Set next number
          </Button>
        </form>
      )}
    </section>
  );
}
