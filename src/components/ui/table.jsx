import * as React from "react"

import { cn } from "@/lib/utils"

// Styling only. Sorting, pagination, selection and row clicks stay in the
// screen that owns the data; these parts render the table's look and pass
// every other prop straight through.

function Table({ className, containerClassName, ...props }) {
  return (
    <div data-slot="table-container" className={cn("relative w-full overflow-x-auto", containerClassName)}>
      <table data-slot="table" className={cn("w-full border-collapse text-left text-xs", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }) {
  return <thead data-slot="table-header" className={cn("bg-muted/50 [&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

function TableBody({ className, ...props }) {
  return <tbody data-slot="table-body" className={cn("divide-y divide-border", className)} {...props} />;
}

function TableRow({ className, ...props }) {
  return (
    <tr
      data-slot="table-row"
      className={cn("transition-colors data-[state=selected]:bg-muted", className)}
      {...props} />
  );
}

function TableHead({ className, ...props }) {
  return (
    <th
      data-slot="table-head"
      className={cn("px-4 py-3.5 text-left align-middle text-[11px] font-bold uppercase tracking-wider text-muted-foreground select-none", className)}
      {...props} />
  );
}

function TableCell({ className, ...props }) {
  return <td data-slot="table-cell" className={cn("px-4 py-3.5 align-middle", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
