// While the IPAS long form is open (#581 follow-up): hears every change written to this IPAS
// (each one is an ipas_events row, in the same transaction as the change itself) and reports
// the ones somebody else made. The user's own saves are ignored. Never touches the form.

import { useCallback, useEffect, useState } from "react";

import { IPAS_PO_CHANGED_REASON } from "../../../constants/ipas";
import { supabase } from "../../../lib/supabase";

const ODOO_SYNC_KINDS = ["odoo_copy_changed", "filled_from_odoo", "odoo_changed_since_filing"];

/**
 * Returns `{ by, dismiss }`: `by` is the name of whoever last changed the IPAS (null when
 * nothing new came in). Subscribes only while `active`; unsubscribes on leave.
 */
export function useIpasChanged({ id, userId, active }) {
  const [by, setBy] = useState(null);
  const dismiss = useCallback(() => setBy(null), []);

  useEffect(() => {
    if (!id || !active) return undefined;
    let gone = false;
    const channel = supabase
      .channel(`ipas_events_${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ipas_events", filter: `ipas_id=eq.${id}` }, async (payload) => {
        // The Odoo sync is not somebody editing (#585): whoever opens or prints writes these.
        if (ODOO_SYNC_KINDS.includes(payload?.new?.kind)) return;
        if (payload?.new?.kind === "approvals_cleared" && payload?.new?.detail?.reason === IPAS_PO_CHANGED_REASON) return;
        const actor = payload?.new?.actor_id ?? null;
        if (actor && actor === userId) return;
        setBy((current) => current ?? "Someone");
        if (!actor) return;
        try {
          const { data } = await supabase.from("employees").select("name").eq("id", actor).maybeSingle();
          if (!gone && data?.name) setBy(data.name);
        } catch {
          // The generic "Someone" stays.
        }
      })
      .subscribe();
    return () => {
      gone = true;
      supabase.removeChannel(channel);
    };
  }, [id, userId, active]);

  useEffect(() => {
    if (!active) setBy(null);
  }, [active]);

  return { by, dismiss };
}

/** The newest event time on a shaped IPAS: the version the form loaded. */
export function loadedVersion(ipas) {
  const events = ipas?.events ?? [];
  let newest = null;
  for (const event of events) if (event?.created_at && (!newest || event.created_at > newest)) newest = event.created_at;
  return newest;
}
