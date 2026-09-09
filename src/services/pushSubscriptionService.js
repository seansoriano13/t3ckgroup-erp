import { supabase } from '../lib/supabase';

/**
 * Manages one employee's desktop push subscriptions.
 *
 * #167: a subscription is keyed by (employee, endpoint) so the same person
 * subscribed from two computers holds two rows, and subscribing twice from
 * the same browser is an upsert rather than a duplicate — the unique
 * constraint on that pair is what makes the upsert idempotent.
 */
export const pushSubscriptionService = {
  /**
   * Stores a `PushSubscription` for the current employee. Safe to call again
   * for the same browser; it replaces the keys rather than duplicating the row.
   */
  async subscribe(employeeId, subscription) {
    const json = typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
    const { endpoint, keys } = json;

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        employee_id: employeeId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      { onConflict: 'employee_id,endpoint' },
    );
    if (error) throw new Error(error.message);
  },

  /** Removes this browser's subscription for the current employee. */
  async unsubscribe(employeeId, endpoint) {
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('employee_id', employeeId)
      .eq('endpoint', endpoint);
    if (error) throw new Error(error.message);
  },

  /** Whether this employee holds a stored subscription for this endpoint. */
  async isSubscribed(employeeId, endpoint) {
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id')
      .eq('employee_id', employeeId)
      .eq('endpoint', endpoint)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return !!data;
  },
};
