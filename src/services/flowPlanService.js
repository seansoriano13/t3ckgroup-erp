import { supabase } from '../lib/supabase';
import { bytesToHex, hexToBytes } from '../lib/bytes';
import { encodeFlowPlanState, loadFlowPlanState } from '../lib/flowPlanDoc';

/**
 * How many times `saveState` will re-merge and retry when another session's
 * save lands between its read and its write. Each round folds in the state
 * that won, so the only way to exhaust this is a plan being saved by more
 * writers than that, continuously — at which point the honest answer is an
 * error rather than a silent loss.
 */
const SAVE_ATTEMPTS = 5;

export const flowPlanService = {
  /**
   * The one shared Sandbox, provisioned on whoever opens it first.
   *
   * Flow Plans folded into a Sandbox mode on Flow Canvas rather than staying
   * a list of named, created-by-form plans: there is only ever one active
   * draft in flight, so nobody names one or chooses from a list — they just
   * open the Sandbox.
   */
  async getOrCreateSandbox(actorId) {
    const { data: existing, error } = await supabase
      .from('flow_plans')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (existing) return existing;

    const { data: created, error: createError } = await supabase
      .from('flow_plans')
      .insert({ name: 'Sandbox', created_by: actorId })
      .select()
      .single();
    if (createError) throw createError;
    return created;
  },

  async getPlan(id) {
    const { data, error } = await supabase
      .from('flow_plans')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;

    return { ...data, yjs_state: hexToBytes(data.yjs_state) };
  },

  /**
   * Stores the plan document.
   *
   * What lands in the column is a merge, never a replacement: the stored state
   * is applied into `doc` first, so anything written by a session this one
   * never heard from survives the save instead of being overwritten by a
   * document that had not seen it. Applying an update is idempotent and
   * commutative, so doing this on every save costs nothing.
   *
   * Reading and writing are two statements, which leaves a window: a third
   * session's save landing between them would be read by nobody and then
   * overwritten. The write therefore carries the `updated_at` it read as a
   * precondition — a compare-and-set — so a save that lost that race matches no
   * rows and is retried against the state that actually won, rather than
   * quietly discarding it. Retries are bounded; each one re-merges, so
   * converging takes at most as many rounds as there are competing writers.
   */
  async saveState(id, doc, { attempts = SAVE_ATTEMPTS } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const { data: existing, error: readError } = await supabase
        .from('flow_plans')
        .select('yjs_state, updated_at')
        .eq('id', id)
        .single();

      if (readError && readError.code !== 'PGRST116') throw readError;

      // The plan is created by `createPlan` before anyone can open it, so a
      // missing row means it has since been deleted. Retrying cannot bring it
      // back, and looping until the attempts run out would report that as a
      // contended save, which is the wrong thing to tell someone.
      if (!existing) {
        throw new Error('This plan no longer exists, so the changes could not be saved.');
      }

      if (existing.yjs_state) loadFlowPlanState(doc, hexToBytes(existing.yjs_state));

      const { data, error } = await supabase
        .from('flow_plans')
        .update({ yjs_state: bytesToHex(encodeFlowPlanState(doc)), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('updated_at', existing.updated_at)
        .select('id');

      if (error) throw error;
      if (data?.length) return;
    }

    throw new Error('Could not save the plan: it kept changing underneath. Try again.');
  },
};
