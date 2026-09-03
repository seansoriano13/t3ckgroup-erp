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
    // Get max sort_order
    const { data: maxData, error: maxErr } = await supabase
      .from('hr_leave_categories')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);

    if (maxErr) throw new Error(maxErr.message);
    const nextSortOrder = (maxData?.[0]?.sort_order || 0) + 1;

    const { data, error } = await supabase
      .from('hr_leave_categories')
      .insert([{ label, sort_order: nextSortOrder, is_active: true }])
      .select()
      .single();

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
    // Using a loop because supabase-js doesn't have a simple upsert/update-many for distinct rows by id
    // In a small config table, this is fine.
    for (const item of ordering) {
      const { error } = await supabase
        .from('hr_leave_categories')
        .update({ sort_order: item.sort_order, updated_at: new Date().toISOString() })
        .eq('id', item.id);
      
      if (error) throw new Error(error.message);
    }

    systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      'bulk-reorder',
      `Reordered leave categories`,
      { event: 'LEAVE_CATEGORIES_REORDERED' },
      actorId
    ).catch(console.error);
  },

  // ==========================================
  // Form Settings
  // ==========================================

  /**
   * Fetch the singleton form settings
   */
  async getFormSettings() {
    const { data, error } = await supabase
      .from('hr_form_settings')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) throw new Error(error.message);
    return data;
  },

  /**
   * Update form settings
   */
  async updateFormSettings(updates, actorId) {
    const { data, error } = await supabase
      .from('hr_form_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)
      .select()
      .single();

    if (error) throw new Error(error.message);

    systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      'form-settings',
      `Updated form printed names/titles`,
      { event: 'FORM_SETTINGS_UPDATED', updates },
      actorId
    ).catch(console.error);

    return data;
  }
};
