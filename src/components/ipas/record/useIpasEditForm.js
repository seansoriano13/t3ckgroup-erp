// The IPAS's edit state (#581), kept by the record page while it is in edit mode: what was
// typed over the stored IPAS, the money rows typed or added, and one Save that stores it all.
// The sections show it in place (EditSectionBody); the bar at the foot (EditBar) holds Save.

import { useEffect, useMemo, useState } from "react";

import { changeCount, formFromIpas, missingFields, planIsEmpty, planSave, sectionProgress } from "./editFormModel";

const LISTS = ["payments", "charges", "documents"];
const emptyRows = () => ({ payments: {}, charges: {}, documents: {} });
const emptyAdded = () => ({ payments: [], charges: [], documents: [] });

/**
 * `can` is what this person may type. `onSave(plan)` stores the typed changes and resolves when
 * they are in (a failure carries `doneKeys`, the new or changed rows already stored).
 * `savedCount` rises when a save finished somewhere else (a Retry from the page's notice).
 */
export function useIpasEditForm({ ipas, savedCount = 0, onSave }) {
  const base = useMemo(() => formFromIpas(ipas), [ipas]);
  const [edits, setEdits] = useState({});
  // Money rows: saved rows typed over, and new rows not stored yet.
  const [rowEdits, setRowEdits] = useState(emptyRows);
  const [added, setAdded] = useState(emptyAdded);
  const [fresh, setFresh] = useState(null);
  const [saved, setSaved] = useState(false);
  const [planError, setPlanError] = useState(null);

  const form = { ...base, ...edits };
  for (const list of LISTS) form[list] = [...base[list].map((row) => rowEdits[list][row.key] ?? row), ...added[list]];

  const set = (key, value) =>
    setEdits((current) => {
      const next = { ...current };
      if (value === base[key]) delete next[key];
      else next[key] = value;
      return next;
    });

  const rows = {
    add: (list, draft) => {
      setAdded((current) => ({ ...current, [list]: [...current[list], draft] }));
      setFresh(draft.key);
      setSaved(false);
    },
    patch: (list, key, patch) => {
      if (added[list].some((row) => row.key === key)) {
        setAdded((current) => ({ ...current, [list]: current[list].map((row) => (row.key === key ? { ...row, ...patch } : row)) }));
        return;
      }
      setRowEdits((current) => {
        const stored = base[list].find((row) => row.key === key);
        const row = { ...(current[list][key] ?? stored), ...patch };
        const next = { ...current[list] };
        if (JSON.stringify(row) === JSON.stringify(stored)) delete next[key];
        else next[key] = row;
        return { ...current, [list]: next };
      });
    },
    drop: (list, key) => setAdded((current) => ({ ...current, [list]: current[list].filter((row) => row.key !== key) })),
  };

  const clear = () => {
    setEdits({});
    setRowEdits(emptyRows());
    setAdded(emptyAdded());
    setPlanError(null);
  };

  // A save finished (even a Retry from the page's notice): what was typed is stored now.
  const [seenSaves, setSeenSaves] = useState(savedCount);
  if (seenSaves !== savedCount) {
    setSeenSaves(savedCount);
    clear();
    setSaved(true);
  }
  // The ease-in is for the moment a row is added only.
  useEffect(() => {
    if (!fresh) return undefined;
    const timer = setTimeout(() => setFresh(null), 1200);
    return () => clearTimeout(timer);
  }, [fresh]);

  const progress = sectionProgress(form);
  const missing = missingFields(form);
  const changed = changeCount(form, base);
  const total = progress.reduce((n, p) => n + p.total, 0);
  const done = progress.reduce((n, p) => n + p.done, 0);

  const save = async () => {
    const plan = planSave(form, base);
    if (plan.error) {
      setPlanError(plan.error);
      return;
    }
    setPlanError(null);
    if (planIsEmpty(plan)) return;
    try {
      await onSave(plan);
      clear();
      setSaved(true);
    } catch (error) {
      // The page keeps the failure with Retry; what was typed stays, except the rows that
      // did get stored before the failure: they are on the IPAS now, so they leave the form.
      const stored = new Set(error?.doneKeys ?? []);
      if (stored.size > 0) {
        setAdded((current) => Object.fromEntries(LISTS.map((list) => [list, current[list].filter((row) => !stored.has(row.key))])));
        setRowEdits((current) =>
          Object.fromEntries(LISTS.map((list) => [list, Object.fromEntries(Object.entries(current[list]).filter(([key]) => !stored.has(key)))])),
        );
      }
    }
  };

  return { form, set, rows, fresh, progress, missing, changed, total, done, save, clear, saved, planError };
}
