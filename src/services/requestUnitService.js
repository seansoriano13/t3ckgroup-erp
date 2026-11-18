import { supabase } from "../lib/supabase";
import { systemAuditLogService } from "./systemAuditLogService";

/**
 * The Unit dropdown of a Purchasing Request item. Everyone signed in reads the list; only Purchasing access
 * and Super Admins change it (row level security), and a change the database filters out comes back as an
 * error. Units are never deleted: switching one off stops it being offered for new items, and items that
 * already hold it keep it (an item stores its unit as plain text).
 */

const SAME_AS_ANOTHER = (label) => `"${label}" is already on the list.`;
const LAST_ONE = "At least one unit has to stay on.";

const byOrder = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.label).localeCompare(String(b.label));
const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

const logChange = (message, changes) =>
  systemAuditLogService
    .addSystemEvent("SETTINGS", "request_units", message, { event: "REQUEST_UNITS_UPDATED", changes })
    .catch(console.error);

/** The database's refusal as a plain sentence, without the table name it leads with. */
function plain(error) {
  if (/at least one unit must stay on/i.test(error?.message ?? "")) return new Error(LAST_ONE);
  if (error?.code === "23505") return new Error("That unit is already on the list.");
  return error;
}

export const requestUnitService = {
  /** Every unit in display order, switched-off ones included (the settings screen shows them). */
  async list() {
    const { data, error } = await supabase.from("request_units").select("*");
    if (error) throw error;
    return (data || []).sort(byOrder);
  },

  /** Adds a unit to the end of the list. The name is unique ignoring case. */
  async add(label) {
    const name = (label || "").trim();
    if (!name) throw new Error("Type the unit's name.");
    const current = await requestUnitService.list();
    const clash = current.find((u) => same(u.label, name));
    if (clash) throw new Error(SAME_AS_ANOTHER(clash.label));
    const sort = current.reduce((max, u) => Math.max(max, u.sort ?? 0), 0) + 10;
    const { data, error } = await supabase
      .from("request_units")
      .insert({ label: name, sort, active: true })
      .select()
      .single();
    if (error) throw plain(error);
    logChange(`Added request unit "${name}"`, { added: name });
    return data;
  },

  /** Renames a unit. Items already filed keep the old word; only the list changes. */
  async rename(id, label) {
    const name = (label || "").trim();
    if (!name) throw new Error("Type the unit's name.");
    const current = await requestUnitService.list();
    const clash = current.find((u) => u.id !== id && same(u.label, name));
    if (clash) throw new Error(SAME_AS_ANOTHER(clash.label));
    const before = current.find((u) => u.id === id);
    const { data, error } = await supabase.from("request_units").update({ label: name }).eq("id", id).select().single();
    if (error) throw plain(error);
    logChange(`Renamed request unit "${before?.label ?? ""}" to "${name}"`, { renamed: { from: before?.label, to: name } });
    return data;
  },

  /** Switches a unit on or off. Never deletes. The last unit left on cannot be switched off. */
  async setActive(id, active) {
    const { data, error } = await supabase
      .from("request_units")
      .update({ active: Boolean(active) })
      .eq("id", id)
      .select()
      .single();
    if (error) throw plain(error);
    logChange(`Switched ${data.active ? "on" : "off"} request unit "${data.label}"`, { label: data.label, active: data.active });
    return data;
  },

  /** Puts the units in the given order (ids, first to last); any not named follow in their old order. */
  async reorder(orderedIds) {
    const current = await requestUnitService.list();
    const known = new Set(current.map((u) => u.id));
    const ids = (orderedIds || []).filter((id) => known.has(id));
    const rest = current.map((u) => u.id).filter((id) => !ids.includes(id));
    const order = [...ids, ...rest];
    const byId = new Map(current.map((u) => [u.id, u]));
    const writes = [];
    order.forEach((id, index) => {
      const sort = (index + 1) * 10;
      if (byId.get(id).sort !== sort) writes.push(supabase.from("request_units").update({ sort }).eq("id", id));
    });
    const results = await Promise.all(writes);
    const failed = results.find((r) => r.error);
    if (failed) throw plain(failed.error);
    return order;
  },
};
