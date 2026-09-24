import * as React from "react";

import { cn } from "@/lib/utils";

// Styling-only table set. Sorting, pagination and selection stay in feature
// code. The scroll wrapper lets wide tables overflow horizontally.
function Table({ className, ...props }) {
  return (
    <div data-slot="table-container" className="overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full border-collapse text-left text-xs", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "bg-muted/50 [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("divide-y divide-border", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }) {
  return (
    <tr
      data-slot="table-row"
      className={cn("transition-colors hover:bg-muted/40", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "select-none px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-4 py-3.5 align-middle", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
