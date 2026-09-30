import React from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Printer, Search, X } from 'lucide-react';
import Avatar from '../../../../components/Avatar';
import HighlightText from '../../../../components/HighlightText';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { FieldBox } from '@/components/ui/FieldBox';
import { Input } from '@/components/ui/input';
import { useDocumentCenter, recordKey, formatRecordDate } from './useDocumentCenter';
import { TYPE_META } from './leaveDisplay';

/**
 * The Document Center as three steps: choose approved records, set their
 * print order (which also decides sheet pairing: two slips per sheet), then
 * check the live preview and print. Print opens the browser's own print
 * dialog; its "Save as PDF" destination covers the case where HR wants a file,
 * so no paid conversion API is involved anywhere in this flow.
 */
export default function DocumentCenterTab(props) {
  const { approvedRecords } = props;
  const {
    tray, trayKeys, previewHtml, isRendering, isBusy, search, setSearch,
    filteredRecords, isInTray, toggleTray, removeFromTray, sensors, handleDragEnd, handlePrint,
  } = useDocumentCenter(props);

  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-[300px_260px_minmax(0,1fr)]">
      <Step n={1} title="Choose records" hint="Approved this period">
        <div className="relative">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees"
            aria-label="Search approved records by employee name"
            containerClassName="w-full"
            className="h-10 pl-10"
          />
        </div>
        <ul className="custom-scrollbar max-h-[640px] overflow-y-auto rounded-2xl border border-border bg-card p-2">
          {filteredRecords.map((req) => {
            const key = recordKey(req);
            const on = isInTray(key);
            return (
              <li key={key}>
                <FieldBox inline className={`gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-muted/60 ${on ? 'bg-muted' : ''}`}>
                  <Avatar name={req.employee?.name} src={req.employee?.avatar_path} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">
                      <HighlightText text={req.employee?.name} search={search} />
                    </span>
                    <span className="block truncate text-xs font-medium text-muted-foreground">
                      {TYPE_META[req.type]?.label ?? req.type} · {formatRecordDate(req)} · {req.hours} hrs
                    </span>
                    {req.printed_at && (
                      <span className="mt-1 inline-block rounded-full bg-mauve-3 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Already printed
                      </span>
                    )}
                  </span>
                  <Checkbox
                    aria-label={`Add ${req.employee?.name}'s ${req.type} record to the tray`}
                    checked={on}
                    onCheckedChange={() => toggleTray(req)}
                    className="size-5 rounded-full"
                  />
                </FieldBox>
              </li>
            );
          })}
          {filteredRecords.length === 0 && (
            <li className="p-8 text-center text-sm font-medium text-muted-foreground">
              {approvedRecords.length === 0 ? 'No approved records for the selected period.' : 'No records match your search.'}
            </li>
          )}
        </ul>
      </Step>

      <Step n={2} title="Set the order" hint="Two slips share a sheet, top then bottom">
        <p className="text-xs font-bold tabular-nums text-foreground">
          {tray.length} {tray.length === 1 ? 'form' : 'forms'} queued
        </p>
        {tray.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm font-medium text-muted-foreground">
            Pick records in step 1, then drag to set the print order.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={trayKeys} strategy={verticalListSortingStrategy}>
              <ol className="flex flex-col gap-2.5">
                {tray.map((r, i) => (
                  <TrayRow key={recordKey(r)} id={recordKey(r)} record={r} index={i} onRemove={() => removeFromTray(recordKey(r))} />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </Step>

      <Step n={3} title="Check and print" hint={'Pick "Save as PDF" in the print dialog for a file'}>
        <Button
          onClick={handlePrint}
          disabled={tray.length === 0 || isBusy || isRendering}
          className="h-11 w-full gap-2 text-sm font-bold sm:w-auto sm:self-start sm:px-6"
        >
          <Printer className="h-4 w-4" />
          {isBusy ? 'Working…' : 'Print'}
        </Button>
        <div className="flex min-h-[720px] overflow-hidden rounded-2xl border border-border bg-muted/40 p-5">
          {tray.length === 0 ? (
            <p className="m-auto text-sm font-medium text-muted-foreground">Your forms preview here, exactly as they print.</p>
          ) : (
            <iframe title="Document preview" srcDoc={previewHtml} className="w-full flex-1 rounded-sm border-0 bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]" />
          )}
        </div>
      </Step>
    </div>
  );
}

function Step({ n, title, hint, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div>
        <h3 className="flex items-center gap-2.5 text-base font-black text-foreground">
          <span className="flex size-7 items-center justify-center rounded-full bg-mauve-12 text-xs font-black text-mauve-1">{n}</span>
          {title}
        </h3>
        {hint && <p className="mt-1 pl-[38px] text-xs font-medium text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function TrayRow({ id, record, index, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-xl border border-border bg-card px-2 py-3 ${isDragging ? 'shadow-lg' : ''} ${index % 2 === 1 ? 'mb-3' : ''}`}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-muted-foreground"
        aria-label={`Drag to reorder ${record.employee?.name}'s ${record.type} record`}
      >
        <GripVertical />
      </Button>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-foreground">{record.employee?.name}</span>
        <span className="block text-xs font-medium text-muted-foreground">
          Sheet {Math.floor(index / 2) + 1} · {index % 2 ? 'bottom' : 'top'}
        </span>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        className="text-muted-foreground"
        aria-label={`Remove ${record.employee?.name}'s ${record.type} record from the tray`}
      >
        <X />
      </Button>
    </li>
  );
}
