import { supabase } from "../lib/supabase";

const MESSAGE_SELECT = "*, author:employees!ipas_messages_author_id_fkey(id, name, avatar_path)";
const PERSON_SELECT = "id, name, avatar_path";

/**
 * The IPAS's own Chat (20261217100000_ipas_chat). Anyone who can read IPAS reads
 * and posts; who is notified is the database's call (a trigger on every message).
 */
export const ipasChatService = {
  /** One page of the thread, oldest first: the `limit` newest before `before`. */
  async listMessagesPage(ipasId, { before = null, limit = 30 } = {}) {
    if (!ipasId) return [];
    let query = supabase
      .from("ipas_messages")
      .select(MESSAGE_SELECT)
      .eq("ipas_id", ipasId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (before) query = query.lt("created_at", before);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).reverse();
  },

  /**
   * Who can be mentioned: everyone who can open an IPAS (Purchasing, Finance, a
   * Super Admin, or anyone on an IPAS sign-off list), by name.
   */
  async listPeople() {
    const [flags, lists] = await Promise.all([
      supabase
        .from("employees")
        .select(PERSON_SELECT)
        .or("has_purchasing_flow.eq.true,has_finance_flow.eq.true,is_super_admin.eq.true")
        .not("is_deleted", "is", true),
      supabase.from("ipas_signer_lists").select(`list_key, employee:employees(${PERSON_SELECT}, is_deleted)`),
    ]);
    if (flags.error) throw flags.error;
    if (lists.error) throw lists.error;
    const byId = new Map((flags.data || []).map((p) => [p.id, p]));
    for (const row of lists.data || []) {
      const e = row.employee;
      if (!e || e.is_deleted || String(row.list_key || "").startsWith("transmittal_")) continue;
      if (!byId.has(e.id)) byId.set(e.id, { id: e.id, name: e.name, avatar_path: e.avatar_path });
    }
    return [...byId.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  },

  async postMessage(ipasId, authorId, content, { attachments = [], mentions = [] } = {}) {
    const text = (content || "").trim();
    const files = (attachments || []).filter((a) => a?.url);
    if (!text && files.length === 0) throw new Error("Write a message or attach a file.");

    const live = (mentions || []).filter((m) => m?.id && m?.name && text.includes(`@${m.name}`));
    const metadata = {};
    if (files.length > 0) metadata.attachments = files;
    if (live.length > 0) metadata.mentions = live.map(({ id, name }) => ({ id, name }));

    const { data, error } = await supabase
      .from("ipas_messages")
      .insert({ ipas_id: ipasId, author_id: authorId, content: text, metadata })
      .select(MESSAGE_SELECT)
      .single();
    if (error) throw error;
    return data;
  },
};
