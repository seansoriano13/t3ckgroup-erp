import { supabase } from "../lib/supabase";

export const chatUnsendService = {
  /** Unsend your own message (15-minute rule is enforced by the database). */
  async unsend(table, messageId) {
    const { error } = await supabase.rpc("unsend_chat_message", {
      p_table: table,
      p_message_id: messageId,
    });
    if (error) throw new Error(error.message);
  },
};
