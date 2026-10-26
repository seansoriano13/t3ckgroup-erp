/**
 * REMOVE-BEFORE-PROD (ADR 0028): the two Direct request screens of the
 * Product status prototype. One is the "New Direct request" form, the other
 * is the SOR side that lists Direct requests made for the project.
 */
import { useState } from "react";
import { Plus } from "lucide-react";

import LinerList from "@/components/record/LinerList";
import PropertyPills from "@/components/record/PropertyPills";
import RecordHeader from "@/components/record/RecordHeader";
import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import ModalShell from "@/components/ui/ModalShell";
import SectionHeader from "@/components/ui/SectionHeader";
import { PROJECT } from "./data";
import { StatusPill } from "./LineStatus";

const PROJECT_LABEL = `${PROJECT.sor} · ${PROJECT.client}`;
const PROJECT_OPTIONS = [
  { value: PROJECT.sor, label: PROJECT_LABEL },
  { value: "none", label: "No project" },
];

/** The New Direct request form. It has no money or OPEX fields. */
export function NewDirectDialog({ open, onOpenChange, number, onSend }) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState(PROJECT.sor);
  const valid = title.trim() !== "";

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Purchase Requests", "New Direct request"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSend({ title: title.trim(), project });
      }}
      actions={
        <Button size="lg" type="submit" disabled={!valid}>
          Send to Purchasing
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">For something to buy that is not one of a project&apos;s products. Purchasing picks it up and you follow it here.</p>
      <PropertyPills items={[{ key: "number", label: "Request number", value: number }]} />
      <div className="space-y-4">
        <FieldBox bare label="What is it for?">
          <Input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Demo unit for the client's test day" autoFocus />
        </FieldBox>
        <div className="space-y-1.5">
          <FieldBox bare label="For a project (optional)">
            <SelectField className="w-full" options={PROJECT_OPTIONS} value={project} onChange={setProject} />
          </FieldBox>
          <p className="pl-1 text-xs text-muted-foreground">
            Shows on that SOR as a Direct request for this project. It is not added to the project&apos;s products.
          </p>
        </div>
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px] text-foreground">
          Write <span className="font-mono font-semibold">{number}</span> in the P0&apos;s Source Document in Odoo, so the app finds the P0.
        </p>
      </div>
    </ModalShell>
  );
}

function directRow(request, showProject = true) {
  return {
    key: request.id,
    testId: "direct-request",
    label: request.title,
    main: request.title,
    sub: (
      <>
        <span className="font-mono">{request.pr}</span>
        {" · "}
        {request.p0 ? <span className="font-mono">{request.p0}</span> : "No P0 yet"}
        {showProject && (request.project === PROJECT.sor ? ` · For ${PROJECT.sor}` : " · No project")}
      </>
    ),
    actions: <StatusPill status={request.status} />,
  };
}

/** View 2: the list of Direct requests, and the button that opens the form. */
export function DirectRequestsView({ requests, onNew }) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Direct requests" description="Things to buy that are not part of a project's products.">
        <Button type="button" onClick={onNew}>
          <Plus size={14} />
          New Direct request
        </Button>
      </SectionHeader>
      <LinerList label="Direct requests" rows={requests.map((r) => directRow(r))} empty="No Direct requests yet." />
    </div>
  );
}

/** View 3: the SOR's side of it. No totals. */
export function SorDirectView({ requests }) {
  const forProject = requests.filter((r) => r.project === PROJECT.sor);
  return (
    <div className="space-y-5">
      <RecordHeader reference={PROJECT.sor} name={PROJECT.client} line={`Sales order ${PROJECT.s0}`} />
      <section className="space-y-3 rounded-2xl border border-border bg-card px-4 py-4" aria-label="Direct requests for this project">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Direct requests for this project</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Requests Purchasing is working on for this project. They are not part of its products.</p>
        </div>
        <LinerList label="Direct requests for this project" rows={forProject.map((r) => directRow(r, false))} empty="No Direct requests for this project." />
      </section>
    </div>
  );
}
