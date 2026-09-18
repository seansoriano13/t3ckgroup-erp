import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

const PEER_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#d946ef', '#f43f5e',
];

/**
 * A stable colour per person, derived from their id rather than their name —
 * two people whose names happen to be the same length are not the same person,
 * and the point of the colour is telling them apart.
 */
export function peerColor(userId) {
  let hash = 0;
  for (const character of String(userId || '')) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return PEER_COLORS[hash % PEER_COLORS.length];
}

/**
 * Who else is in this canvas, and where their pointer is (issue #117).
 *
 * Scoped to whatever `scopeId` names — a Flow Plan, in practice — so two plans
 * open at once never bleed their viewers into each other. Presence lives on
 * plans rather than on the operational Flow Canvas because a plan is the place
 * where working together is the point; the operational canvas edits live
 * records, where two people on one flow is a hazard rather than a feature.
 *
 * The viewer's own cursor is never returned: the browser already draws it.
 */
export function useFlowPresence({ scopeId, user, onPeerNodeDrag } = {}) {
  const [peers, setPeers] = useState([]);
  const [cursors, setCursors] = useState({});
  const channelRef = useRef(null);

  // Held in a ref so a new callback identity on every render does not tear the
  // subscription down and rebuild it.
  const dragHandler = useRef(onPeerNodeDrag);
  useEffect(() => {
    dragHandler.current = onPeerNodeDrag;
  }, [onPeerNodeDrag]);

  const userId = user?.id;
  const userName = user?.name;

  useEffect(() => {
    // Nothing to be present in. Leaving the previous scope already cleared the
    // roster on the way out, in this effect's cleanup.
    if (!scopeId || !userId) return undefined;

    const channel = supabase.channel(`flow_presence_${scopeId}`, {
      config: {
        presence: { key: userId },
        broadcast: { self: false },
      },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const others = [];
        for (const [key, entries] of Object.entries(state || {})) {
          if (key === userId || !entries?.length) continue;
          others.push(entries[0]);
        }
        setPeers(others);

        // A cursor outlives its owner otherwise, hanging on the canvas as a
        // ghost of someone who has already closed the plan.
        const present = new Set(others.map((peer) => peer.userId));
        setCursors((current) => {
          const next = {};
          for (const [id, position] of Object.entries(current)) {
            if (present.has(id)) next[id] = position;
          }
          return next;
        });
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (!payload || payload.userId === userId) return;
        setCursors((current) => ({ ...current, [payload.userId]: payload.cursor }));
      })
      .on('broadcast', { event: 'node-drag' }, ({ payload }) => {
        if (!payload || payload.userId === userId) return;
        dragHandler.current?.(payload);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        channel.track({
          userId,
          name: userName || 'Unknown',
          color: peerColor(userId),
        });
      });

    return () => {
      channelRef.current = null;
      // Untracking before the socket closes is what makes the viewer disappear
      // from everyone else's list now rather than when the server times them out.
      try {
        channel.untrack?.();
      } catch {
        // The channel may already be closing; unsubscribing below covers it.
      }
      channel.unsubscribe();
      setPeers([]);
      setCursors({});
    };
  }, [scopeId, userId, userName]);

  const broadcast = useCallback((event, payload) => {
    const channel = channelRef.current;
    if (!channel || channel.state !== 'joined') return;
    channel.send({ type: 'broadcast', event, payload })?.catch?.(() => {});
  }, []);

  const publishCursor = useCallback(
    (position) => broadcast('cursor', { userId, cursor: position }),
    [broadcast, userId],
  );

  const publishNodeDrag = useCallback(
    (nodeId, position) => broadcast('node-drag', { userId, nodeId, position }),
    [broadcast, userId],
  );

  return { peers, cursors, publishCursor, publishNodeDrag };
}
