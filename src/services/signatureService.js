import { supabase } from '../lib/supabase';

const BUCKET = 'signatures';

export const signatureService = {
  /**
   * Uploads a new signature version for an employee and points their record
   * at it. The previous version's file is left in place, untouched — a new
   * distinct path every time is what "replacing a signature creates a new
   * version" means here, not overwriting the old one.
   */
  async saveSignature(employeeId, file) {
    if (!employeeId) throw new Error('Missing employee id.');
    if (!file) throw new Error('Missing signature file.');

    const path = `${employeeId}/${crypto.randomUUID()}.png`;

    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: 'image/png', upsert: false });
    if (uploadErr) throw new Error(uploadErr.message);

    const { data, error } = await supabase
      .from('employees')
      .update({ signature_path: path, updated_at: new Date().toISOString() })
      .eq('id', employeeId)
      .select()
      .single();
    if (error) throw new Error(error.message);

    return data;
  },

  /**
   * A time-limited URL for rendering a stored signature — the bucket is
   * private, so there is no public URL to hand to an <img> directly.
   */
  async getSignatureUrl(path, expiresIn = 3600) {
    if (!path) return null;

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn);
    if (error) throw new Error(error.message);

    return data.signedUrl;
  },
};
