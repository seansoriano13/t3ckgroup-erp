import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { supabase } from '../lib/supabase';
import { base64ToBytes, bytesToBase64 } from '../lib/bytes';
import { createFlowPlanDoc, loadFlowPlanState } from '../lib/flowPlanDoc';
import { flowPlanService } from '../services/flowPlanService';

/** Marks an update that arrived from a peer, so it is not echoed back out. */
const REMOTE = 'remote';

const PERSIST_DELAY_MS = 800;

/**
 * Binds a Flow Plan's document to the other people editing it (issue #116).
 *
 * The document itself (`src/lib/flowPlanDoc.js`) decides how two edits merge;
 * this hook's only job is delivery, and it does three things:
 *
 *   - every local change is broadcast to the plan's channel;
 *   - every change that arrives is applied to the document, which merges it;
 *   - on joining, it asks the room for whatever it is missing, handing over its
 *     state vector so peers can answer with exactly the difference. That is
 *     what makes a session that dropped its connection come back and reconcile
 *     rather than overwrite what happened while it was away.
 *
 * Persistence is debounced and only fired by the session that made the change:
 * `saveState` merges into the stored state before writing, so whichever session
 * saves, what lands in the column is the state the session arrived at.
 */
export function useFlowPlanDoc(planId) {
  // One document per mount. `FlowPlanSandboxPage` keys the provider on the plan
  // id, so opening a different plan remounts rather than merging one plan's
  // document into another's.
  const [doc] = useState(createFlowPlanDoc);

  const [isLoading, setIsLoading] = useState(true);
  // Bumped on every change to the document, local or remote, so consumers can
  // re-read a plain snapshot of it. The document mutates in place, so a version
  // counter is what tells React anything happened at all.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const bump = () => setRevision((n) => n + 1);
    doc.on('update', bump);
    return () => doc.off('update', bump);
  }, [doc]);

  useEffect(() => {
    let cancelled = false;

    flowPlanService
      .getPlan(planId)
      .then((plan) => {
        if (cancelled) return;
        // Merges rather than replaces: peers may already have sent updates
        // while this read was in flight.
        loadFlowPlanState(doc, plan?.yjs_state);
      })
      .catch((error) => console.error('Failed to load the plan document', error))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [planId, doc]);

  useEffect(() => {
    if (!planId) return undefined;

    const channel = supabase.channel(`flow_plan_doc_${planId}`, {
      config: { broadcast: { self: false } },
    });

    const send = (event, payload) => {
      if (channel.state !== 'joined') return;
      channel.send({ type: 'broadcast', event, payload }).catch(() => {});
    };

    let persistTimer = null;
    let persistPending = false;

    const persistNow = () => {
      persistTimer = null;
      persistPending = false;
      flowPlanService.saveState(planId, doc).catch((error) => {
        console.error('Failed to save the plan document', error);
      });
    };

    const schedulePersist = () => {
      persistPending = true;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(persistNow, PERSIST_DELAY_MS);
    };

    const onLocalUpdate = (update, origin) => {
      if (origin === REMOTE) return;
      send('update', { update: bytesToBase64(update) });
      schedulePersist();
    };

    channel
      .on('broadcast', { event: 'update' }, ({ payload }) => {
        if (!payload?.update) return;
        Y.applyUpdate(doc, base64ToBytes(payload.update), REMOTE);
      })
      .on('broadcast', { event: 'sync-request' }, ({ payload }) => {
        if (!payload?.stateVector) return;
        // Answer with precisely what the asker has not seen.
        const missing = Y.encodeStateAsUpdate(doc, base64ToBytes(payload.stateVector));
        send('update', { update: bytesToBase64(missing) });
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        send('sync-request', { stateVector: bytesToBase64(Y.encodeStateVector(doc)) });
      });

    doc.on('update', onLocalUpdate);

    return () => {
      doc.off('update', onLocalUpdate);
      if (persistTimer) clearTimeout(persistTimer);
      // A change made in the last few hundred milliseconds must not be lost to
      // navigating away.
      if (persistPending) persistNow();
      channel.unsubscribe();
    };
  }, [planId, doc]);

  return { doc, revision, isLoading };
}
