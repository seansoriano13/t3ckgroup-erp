import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { transmittalService } from "@/services/transmittalService";
import { ipasErrorMessage } from "@/utils/ipas";

/**
 * The first TG03 number (#252), set once at go-live by a Super Admin. The
 * database refuses it once any Transmittal exists, so this screen only offers
 * the field; a refusal reads as the database's words.
 */
export default function TransmittalFirstNumber() {
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: () => transmittalService.setFirstNumber(value),
    onSuccess: (done) => {
      toast.success(`The next Transmittal is ${done.number_format}.`);
      setValue("");
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid="transmittal-first-number">
      <h3 className="text-sm font-semibold text-foreground">TG03 first number</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        The number the first Transmittal takes, continuing the paper series (TG03-526 means 526). Set once, before the
        first Transmittal is raised.
      </p>
      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) save.mutate();
        }}
      >
        <FieldBox label="First number" bare className="w-40">
          <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 526" />
        </FieldBox>
        <Button type="submit" variant="outline" disabled={save.isPending || !value.trim()}>
          Set first number
        </Button>
      </form>
    </section>
  );
}
