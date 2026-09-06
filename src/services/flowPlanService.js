import { supabase } from '../lib/supabase';

function uint8ArrayToHex(arr) {
  if (!arr) return null;
  return '\\x' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex) {
  if (!hex) return null;
  if (hex.startsWith('\\x')) hex = hex.slice(2);
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return arr;
}

export const flowPlanService = {
  async getPlan(id) {
    const { data, error } = await supabase
      .from('flow_plans')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;

    if (data.yjs_state) {
      data.yjs_state = hexToUint8Array(data.yjs_state);
    }
    return data;
  },

  async savePlan(id, yjsStateUint8, authorId) {
    const hexState = uint8ArrayToHex(yjsStateUint8);
    
    const { data: existing } = await supabase
      .from('flow_plans')
      .select('id')
      .eq('id', id)
      .single();

    if (existing) {
      const { error } = await supabase
        .from('flow_plans')
        .update({
          yjs_state: hexState,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('flow_plans')
        .insert({
          id,
          name: 'Draft Plan',
          created_by: authorId,
          yjs_state: hexState
        });
      if (error) throw error;
    }
  }
};
