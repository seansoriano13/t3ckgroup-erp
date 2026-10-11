import { useState, useEffect, useMemo, useCallback } from 'react';
import { KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import toast from 'react-hot-toast';
import { hydrateRecordsForPrint, buildPrintableDocument, printComposedHtml } from '../../../../lib/pdf/htmlPrinter';
import { getFormType } from '../../../../lib/pdf/formTypeRegistry';

const TRAY_STORAGE_KEY = 'documentCenterTray:v1';

/** Same composite key the rest of this page already uses for a leave/OT record. */
export function recordKey(r) {
  return r.type + '-' + (r.leave_group_id || r.id);
}

export function formatRecordDate(r) {
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
 * State and handlers behind the Document Center: the print tray, its live
 * preview, search, drag-reorder and print. Split from the tab so the layout
 * can change without touching any of it.
 */
export function useDocumentCenter({ approvedRecords, allLoadedRecords, hrId, onPrinted }) {
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  return {
    tray, setTray, trayKeys, previewHtml, isRendering, isBusy, search, setSearch,
    filteredRecords, isInTray, toggleTray, removeFromTray, sensors, handleDragEnd, handlePrint,
  };
}
