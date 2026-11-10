import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { transmittalService } from "@/services/transmittalService";
import { ipasErrorMessage } from "@/utils/ipas";
import { transmittalKeys } from "./transmittalKeys";

/**
 * The first TG03 number (#252), set once at go-live by a Super Admin. Once
 * any Transmittal exists the database refuses it, so the field gives way to
 * the number the series started at.
 */
export default function TransmittalFirstNumber() {
  const [value, setValue] = useState("");
  const queryClient = useQueryClient();
  const first = useQuery({
    queryKey: [...transmittalKeys.all, "first-number"],
    queryFn: () => transmittalService.firstNumber(),
  });

  const save = useMutation({
    mutationFn: () => transmittalService.setFirstNumber(value),
    onSuccess: (done) => {
      toast.success(`The next Transmittal is ${done.number_format}.`);
      setValue("");
    },
    onError: (error) => {
      toast.error(ipasErrorMessage(error));
      queryClient.invalidateQueries({
        queryKey: [...transmittalKeys.all, "first-number"],
      });
    },
  });

  return (
    <section
      className="rounded-xl border border-border bg-card p-4"
      data-testid="transmittal-first-number"
    >
      <h3 className="text-sm font-semibold text-foreground">
        TG03 first number
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The number the first Transmittal takes, continuing the paper series
        (TG03-526 means 526). Set once, before the first Transmittal is raised.
      </p>
      {first.data ? (
        <p
          className="mt-3 text-xs text-foreground"
          data-testid="transmittal-first-number-locked"
        >
          Numbering started at{" "}
          <span className="font-semibold">{first.data}</span>. It can't change
          now that a Transmittal has been raised.
        </p>
      ) : (
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) save.mutate();
          }}
        >
          <FieldBox label="First number" bare className="w-40">
            <Input
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 526"
            />
          </FieldBox>
          <Button
            type="submit"
            variant="outline"
            disabled={save.isPending || !value.trim()}
          >
            Set first number
          </Button>
        </form>
      )}
    </section>
  );
}
