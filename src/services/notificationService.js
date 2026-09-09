import { supabase } from '../lib/supabase';
import { sameDepartment } from '../utils/compareDepartment.js';
import { isPushNotificationType } from '../constants/pushNotificationTypes.js';

/**
 * Writes one notification per recipient, routing each through the
 * send-push edge function when `type` is push-eligible and inserting
 * directly otherwise. The one place `createNotification`, `broadcastToRole`
 * and `notifyHeadByDepartment` all funnel through, so the push/in-app split
 * is made once rather than re-decided at each call site.
 */
async function dispatchToRecipients(recipientIds, { sender_id = null, type, title, message, reference_id = null }) {
  if (recipientIds.length === 0) return;

  if (isPushNotificationType(type)) {
    await Promise.all(
      recipientIds.map((recipient_id) =>
        supabase.functions.invoke('send-push', {
          body: { recipient_id, sender_id, type, title, message, reference_id },
        }),
      ),
    );
    return;
  }

  await supabase.from('notifications').insert(
    recipientIds.map((recipient_id) => ({
      recipient_id,
      sender_id,
      type,
      title,
      message,
      reference_id,
    })),
  );
}

export const notificationService = {
  /**
   * Fetch notifications mapped out for a specific user ID
   * Includes sender name details
   */
  async getMyNotifications(userId) {
    if (!userId) return [];
    
    const { data, error } = await supabase
      .from('notifications')
      .select(`
        *,
        sender:employees!notifications_sender_id_fkey(name, department, avatar_path)
      `)
      .eq('recipient_id', userId)
      .order('created_at', { ascending: false })
      .limit(50); // cap to 50 for performance

    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Listen to real-time notification events
   */
  subscribeToNotifications(userId, onNotification) {
    if (!userId) return null;
    return supabase
      .channel(`public:notifications:recipient_id=eq.${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        (payload) => {
          onNotification(payload.new);
        }
      )
      .subscribe();
  },

  /**
   * Mark a single notification as read
   */
  async markAsRead(notificationId) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId)
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Mark a single notification as unread
   */
  async markAsUnread(notificationId) {
    const { data, error } = await supabase
      .from('notifications')
      .update({ is_read: false })
      .eq('id', notificationId)
      .select()
      .single();
      
    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Delete a notification
   */
  async deleteNotification(notificationId) {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);
      
    if (error) throw new Error(error.message);
  },

  /**
   * Mark all unread notifications for a specific user as read
   */
  async markAllAsRead(userId) {
    if (!userId) return;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);
      
    if (error) throw new Error(error.message);
  },

  /**
   * Mark all notifications for a specific user as unread
   */
  async markAllAsUnread(userId) {
    if (!userId) return;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: false })
      .eq('recipient_id', userId);
      
    if (error) throw new Error(error.message);
  },

  /**
   * Internal mechanism to safely fire and forget a notification.
   *
   * #166/#168: a mention, a task assignment, a decision on your own request,
   * and a request awaiting your approval also need to reach a closed tab, so
   * those four types are created by the send-push edge function instead of
   * inserted directly — a closed tab cannot send anything itself. Every
   * other type keeps being written here, client-side, exactly as before.
   * This is the one place that decision is made; callers do not need to know
   * which path their type takes.
   */
  async createNotification({ recipient_id, sender_id = null, type, title, message, reference_id = null }) {
     try {
       // Fire & Forget so it doesn't block primary mutation flows
       await dispatchToRecipients([recipient_id], { sender_id, type, title, message, reference_id });
     } catch (err) {
       console.error("Failed to silently dispatch notification:", err);
     }
  },

  /**
   * Broadcast a notification to entire functional roles (e.g. ['HR', 'SUPER_ADMIN'])
   */
  async broadcastToRole(rolesArray, { sender_id = null, type, title, message, reference_id = null, excludeSuperAdmin = false }) {
     try {
       const { data: emps } = await supabase.from('employees').select('id, department, is_super_admin, is_hr, is_head').neq('is_deleted', true);
       if (!emps) return;

       const recipientIds = [];
       emps.forEach(emp => {
          let shouldInclude = false;
          if (rolesArray.includes('SUPER_ADMIN') && emp.is_super_admin) shouldInclude = true;
          if (rolesArray.includes('HR') && emp.is_hr) shouldInclude = true;
          if (rolesArray.includes('HEAD') && emp.is_head) shouldInclude = true;

          // Optionally exclude Super Admins (e.g. for HR-only signals they don't need)
          if (excludeSuperAdmin && emp.is_super_admin) shouldInclude = false;

          if (shouldInclude) recipientIds.push(emp.id);
       });

       await dispatchToRecipients(recipientIds, { sender_id, type, title, message, reference_id });
     } catch (err) {
       console.error("Failed to execute broadcast notification:", err);
     }
  },

  /**
   * Target a specific Department Head dynamically based on department and sub-department
   */
  async notifyHeadByDepartment(departmentString, subDeptString, { sender_id = null, type, title, message, reference_id = null }) {
     if (!departmentString && !subDeptString) return;
     try {
       const { data: allHeads } = await supabase
         .from('employees')
         .select('id, department, sub_department')
         .eq('is_head', true)
         .neq('is_deleted', true);

       if (!allHeads || allHeads.length === 0) return;

       const targetHeads = allHeads.filter(h => {
           if (subDeptString && sameDepartment(h.sub_department, subDeptString)) return true;
           if (departmentString && sameDepartment(h.department, departmentString) && !h.sub_department) return true;
           return false;
        });

       if (targetHeads.length === 0) return;

       await dispatchToRecipients(targetHeads.map((h) => h.id), { sender_id, type, title, message, reference_id });
     } catch (err) {
       console.error("Failed to notify department head:", err);
     }
  }
};
