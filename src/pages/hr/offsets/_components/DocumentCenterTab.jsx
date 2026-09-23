import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Printer, X, FileStack, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import Avatar from '../../../../components/Avatar';
import HighlightText from '../../../../components/HighlightText';
import { hydrateRecordsForPrint, buildPrintableDocument, printComposedHtml } from '../../../../lib/pdf/htmlPrinter';
import { getFormType } from '../../../../lib/pdf/formTypeRegistry';
import { Button } from '@/components/ui/button';

const TRAY_STORAGE_KEY = 'documentCenterTray:v1';

/** Same composite key the rest of this page already uses for a leave/OT record. */
function recordKey(r) {
  return r.type + '-' + (r.leave_group_id || r.id);
}

function formatRecordDate(r) {
  if (r.dayCount > 1) {
    const start = new Date(r.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const end = new Date(r.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return `${start} – ${end}`;
  }
  return new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function loadStoredTray() {
  try {
    const raw = localStorage.getItem(TRAY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The Document Center tab: pick approved records into a staging tray, drag
 * to set print order (which also determines sheet-pairing), and preview
 * the exact composed output before printing. Print opens the browser's own
 * print dialog — free, and its "Save as PDF" destination covers the case
 * where HR wants a file instead of paper, so no paid conversion API is
 * involved anywhere in this flow.
 */
export default function DocumentCenterTab({ approvedRecords, allLoadedRecords, hrId, onPrinted }) {
  const [tray, setTray] = useState(loadStoredTray);
  const [previewHtml, setPreviewHtml] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(TRAY_STORAGE_KEY, JSON.stringify(tray));
    } catch {
      // localStorage unavailable (private browsing, quota) — the tray just won't survive a reload.
    }
  }, [tray]);

  const trayKeys = useMemo(() => tray.map(recordKey), [tray]);

  // The tray should only drop a key once it is known that the record genuinely no longer exists,
  // not merely that it is absent from the currently-loaded window.
  useEffect(() => {
    setTray((prevTray) => {
      let changed = false;
      const nextTray = [];
      const approvedKeys = new Set(approvedRecords.map(recordKey));
      const allLoadedKeys = new Set((allLoadedRecords || []).map(recordKey));

      for (const item of prevTray) {
        const k = recordKey(item);
        if (allLoadedKeys.has(k)) {
          if (approvedKeys.has(k)) {
            // It's loaded and approved. Update to the latest version just in case fields changed.
            const latest = approvedRecords.find((r) => recordKey(r) === k);
            nextTray.push(latest);
            // We consider it changed to trigger a re-render if the reference changes, though typically we just rely on length.
            changed = true; 
          } else {
            // It's loaded but NOT approved (e.g. decision undone). Drop it.
            changed = true;
          }
        } else {
          // It's not in the loaded window at all. Keep it as is.
          nextTray.push(item);
        }
      }

      if (prevTray.length !== nextTray.length) changed = true;
      return changed ? nextTray : prevTray;
    });
  }, [approvedRecords, allLoadedRecords]);

  const isInTray = useCallback((key) => trayKeys.includes(key), [trayKeys]);

  // Search scopes the picker to a name match — the tray can still hold records
  // that later scroll out of a filtered view, so filtering never touches tray.
  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return approvedRecords;
    return approvedRecords.filter((r) => r.employee?.name?.toLowerCase().includes(term));
  }, [approvedRecords, search]);

  const toggleTray = (record) => {
    const key = recordKey(record);
    setTray((prev) => (prev.some((r) => recordKey(r) === key) ? prev.filter((r) => recordKey(r) !== key) : [...prev, record]));
  };

  const removeFromTray = (key) => setTray((prev) => prev.filter((r) => recordKey(r) !== key));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setTray((prev) => {
      const oldIndex = prev.findIndex((r) => recordKey(r) === active.id);
      const newIndex = prev.findIndex((r) => recordKey(r) === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  // Live preview: re-hydrate and re-render whenever the tray's order or contents change.
  useEffect(() => {
    let cancelled = false;
    if (tray.length === 0) {
      setPreviewHtml('');
      return undefined;
    }
    setIsRendering(true);
    hydrateRecordsForPrint(tray)
      .then((mapped) => {
        if (!cancelled) setPreviewHtml(buildPrintableDocument(mapped));
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message || 'Failed to render preview');
      })
      .finally(() => {
        if (!cancelled) setIsRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tray]);

  const handlePrint = async () => {
    if (!previewHtml) return;
    setIsBusy(true);
    try {
      await printComposedHtml(previewHtml);
      await Promise.all(tray.map((r) => getFormType(r.type).markPrinted(r, hrId)));
      onPrinted?.();
    } catch (err) {
      toast.error(err.message || 'Failed to print');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4 animate-in fade-in duration-300">
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-[640px]">
        <div className="p-3 border-b border-border bg-muted/10 flex items-center gap-2">
          <FileStack className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-bold text-foreground uppercase tracking-wider">Preview</span>
        </div>
        {tray.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center text-muted-foreground text-sm font-medium p-8">
            Nothing to preview yet.
          </div>
        ) : (
          <iframe title="Document preview" srcDoc={previewHtml} className="w-full flex-1 border-0" />
        )}
      </div>

      <div className="flex flex-col gap-4">
        <Button
          onClick={handlePrint}
          disabled={tray.length === 0 || isBusy || isRendering}
          className="h-auto gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
        >
          <Printer className="w-4 h-4" />
          {isBusy ? 'Working…' : 'Print'}
        </Button>
        <p className="text-[11px] text-muted-foreground font-medium leading-relaxed -mt-2 px-1">
          Opens your browser's print dialog — choose "Save as PDF" there if you need a file instead of paper.
        </p>

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col h-[420px]">
          <div className="p-3 border-b border-border bg-muted/10 shrink-0">
            <span className="text-sm font-bold text-foreground">Tray ({tray.length})</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {tray.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-muted-foreground text-xs font-medium p-6 bg-muted/20">
                Check records below to add them here, then drag to set print order.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={trayKeys} strategy={verticalListSortingStrategy}>
                  <ul className="divide-y divide-border">
                    {tray.map((r) => (
                      <TrayRow key={recordKey(r)} id={recordKey(r)} record={r} onRemove={() => removeFromTray(recordKey(r))} />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col h-[420px]">
          <div className="p-3 border-b border-border bg-muted/10 shrink-0 space-y-2">
            <span className="text-sm font-bold text-foreground">
              {search.trim() ? `${filteredRecords.length} of ${approvedRecords.length} Approved Records` : `${approvedRecords.length} Approved Records`}
            </span>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name…"
                aria-label="Search approved records by employee name"
                className="w-full pl-7 pr-2 py-1.5 text-xs font-medium rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
          </div>
          <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-border">
            {filteredRecords.map((req) => {
              const key = recordKey(req);
              return (
                <li key={key} className={`flex items-center gap-3 p-3 ${isInTray(key) ? 'bg-primary/5' : ''}`}>
                  <input
                    type="checkbox"
                    aria-label={`Add ${req.employee?.name}'s ${req.type} record to the tray`}
                    className="rounded border-border text-primary focus:border-foreground/30 w-4 h-4 cursor-pointer shrink-0"
                    checked={isInTray(key)}
                    onChange={() => toggleTray(req)}
                  />
                  <Avatar name={req.employee?.name} src={req.employee?.avatar_path} size="sm" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">
                      <HighlightText text={req.employee?.name} search={search} />
                    </p>
                    <p className="text-[10px] text-muted-foreground font-semibold">
                      {formatRecordDate(req)} · {req.hours} hrs
                    </p>
                  </div>
                  <span className={`shrink-0 font-black uppercase tracking-wider px-2 py-0.5 rounded text-[9px] border ${
                    req.type === 'OVERTIME' ? 'bg-primary/10 text-primary border-primary/20' :
                    req.type === 'OFFSET' ? 'bg-blue-2 text-blue-11 border-blue-6' : 'bg-green-2 text-green-11 border-green-6'
                  }`}>
                    {req.type}
                  </span>
                  {req.printed_at && (
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                      Already printed
                    </span>
                  )}
                </li>
              );
            })}
            {filteredRecords.length === 0 && (
              <li className="p-8 text-center text-muted-foreground text-xs font-medium">
                {approvedRecords.length === 0 ? 'No approved records for the selected period.' : 'No records match your search.'}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function TrayRow({ id, record, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 p-3 bg-card">
      <Button
        variant="ghost"
        size="icon"
        {...attributes}
        {...listeners}
        className="h-auto w-auto cursor-grab touch-none p-0 text-muted-foreground hover:bg-transparent"
        aria-label={`Drag to reorder ${record.employee?.name}'s ${record.type} record`}
      >
        <GripVertical className="w-4 h-4" />
      </Button>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-foreground truncate">{record.employee?.name}</p>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-bold">{record.type} · {record.hours} hrs</p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="h-auto w-auto p-0 text-muted-foreground hover:bg-transparent hover:text-destructive"
        aria-label={`Remove ${record.employee?.name}'s ${record.type} record from the tray`}
      >
        <X className="w-4 h-4" />
      </Button>
    </li>
  );
}
