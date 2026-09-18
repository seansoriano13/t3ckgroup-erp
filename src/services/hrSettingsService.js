import { supabase } from '../lib/supabase';
import { systemAuditLogService } from './systemAuditLogService';

export const hrSettingsService = {
  // ==========================================
  // Leave Categories
  // ==========================================

  /**
   * Fetch all leave categories, ordered by sort_order
   */
  async getLeaveCategories(includeInactive = false) {
    let query = supabase.from('hr_leave_categories').select('*').order('sort_order', { ascending: true });
    
    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },

  /**
   * Add a new leave category
   */
  async addLeaveCategory(label, actorId) {
    const { data, error } = await supabase
      .rpc('add_leave_category', { p_label: label });

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      data.id,
      `Created leave category "${label}"`,
      { event: 'LEAVE_CATEGORY_CREATED', label },
      actorId
    ).catch(console.error);

    return data;
  },

  /**
   * Update a leave category's label or active status
   */
  async updateLeaveCategory(id, updates, actorId) {
    const { data, error } = await supabase
      .from('hr_leave_categories')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      id,
      `Updated leave category "${data.label}"`,
      { event: 'LEAVE_CATEGORY_UPDATED', updates },
      actorId
    ).catch(console.error);

    return data;
  },

  /**
   * Update the sort order of all categories at once
   * @param {Array<{id: string, sort_order: number}>} ordering
   */
  async reorderLeaveCategories(ordering, actorId) {
    const { error } = await supabase
      .rpc('reorder_leave_categories', { p_ordering: ordering });

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      'bulk-reorder',
      `Reordered leave categories`,
      { event: 'LEAVE_CATEGORIES_REORDERED' },
      actorId
    ).catch(console.error);
  }
};
