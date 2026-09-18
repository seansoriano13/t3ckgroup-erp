import { supabase } from '../lib/supabase';

/**
 * The company register (issue #142): T3CK Group's five entities. A thin
 * read service — the register is seeded by migration and, for now, edited
 * directly in the database (see spec's "add a company later" note); this
 * only needs to list them for the employee/apply selectors and filters.
 */
export const companyService = {
  async getCompanies(includeInactive = false) {
    let query = supabase.from('companies').select('*').order('sort_order', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  },
};

/**
 * One rule shared by every company filter dropdown in HR (Employee
 * Directory, the Offsets/SIL/Overtime queue): "ALL" passes everything,
 * "NONE" isolates records with no company recorded, and any other value is
 * an exact company id match. Kept in one place so the four filter sites
 * that need it can't drift on what "NONE" means.
 */
export function matchesCompanyFilter(companyId, filterValue) {
  if (filterValue === 'ALL') return true;
  if (filterValue === 'NONE') return !companyId;
  return companyId === filterValue;
}
