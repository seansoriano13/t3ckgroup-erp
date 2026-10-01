import { supabase } from "../lib/supabase";
import { isLocal, isStaging } from "../lib/appEnv";
import { formatBuildFingerprint } from "../utils/buildFingerprint";

const BUCKET = "bug-reports";
export const BUG_REPORT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Whether a report is old enough (a full calendar year) for its files to be
 * deleted. Calendar year, not 365 days, to agree with the database's
 * `now() - interval '1 year'` across a leap day.
 */
export function isPastRetention(report, now = Date.now()) {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  return new Date(report.created_at) < cutoff;
}

function environment() {
  if (isLocal) return "local";
  if (isStaging) return "staging";
  return import.meta.env.DEV ? "development" : "production";
}

function appVersion() {
  const fingerprint = formatBuildFingerprint(__APP_VERSION__, __BUILD_TIME__);
  return fingerprint === "dev" ? __APP_SEMVER__ : `${__APP_SEMVER__} (${fingerprint})`;
}

/**
 * Bug Reports (CONTEXT.md). Sending, Notes and Resolved go through RPCs; the
 * table is readable by Super Admins and holders of the Bug Reports access
 * right, and by each sender for their own reports. Files sit in the private
 * `bug-reports` bucket under the sender's employee id, so the page opens them
 * through signed URLs.
 */
export const bugReportService = {
  /** Uploads one file and returns the descriptor stored on the report. */
  async uploadAttachment(employeeId, file) {
    if (!employeeId) throw new Error("Missing employee id.");
    const dot = file.name.lastIndexOf(".");
    const ext = dot > 0 ? file.name.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, "") : "";
    const path = `${employeeId}/${crypto.randomUUID()}${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw new Error(error.message);

    return { path, name: file.name, type: file.type || "", bytes: file.size };
  },

  /** Sends a report. Returns its id. */
  async submit({ description, attachments = [], pageUrl = null }) {
    const { data, error } = await supabase.rpc("submit_bug_report", {
      p_description: (description || "").trim(),
      p_attachments: attachments,
      p_page_url: pageUrl,
      p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      p_app_version: appVersion(),
      p_environment: environment(),
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /** Every report the caller can see (all for a reader, their own otherwise), newest first. */
  async list() {
    const { data, error } = await supabase
      .from("bug_reports")
      .select("*, reporter:employees!bug_reports_reporter_id_fkey(name, department, sub_department)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  },

  async setResolved(id, resolved) {
    const { error } = await supabase.rpc("set_bug_report_resolved", { p_id: id, p_resolved: resolved });
    if (error) throw new Error(error.message);
  },

  /** A report's thread (notes plus Resolved / Reopened events), oldest first. */
  async listNotes(reportId) {
    const { data, error } = await supabase
      .from("bug_report_notes")
      .select("*, author:employees!bug_report_notes_author_id_fkey(id, name)")
      .eq("report_id", reportId)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  },

  /** Adds a note to a report's thread; notifies the other side. */
  async addNote(reportId, body) {
    const { data, error } = await supabase.rpc("add_bug_report_note", {
      p_report_id: reportId,
      p_body: (body || "").trim(),
    });
    if (error) throw new Error(error.message);
    return data;
  },

  /** The report's attachment descriptors with a signed `url` added to each. */
  async withUrls(attachments = []) {
    if (!attachments.length) return [];
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(attachments.map((a) => a.path), 60 * 60);
    if (error) throw new Error(error.message);
    return attachments.map((a, i) => ({ ...a, url: data[i]?.signedUrl || null }));
  },

  /**
   * Deletes the files of reports over a year old and empties their attachment
   * list. Run once when the Bug Reports page opens; returns how many were
   * purged. One report failing does not stop the rest: it is retried on the
   * next open (removing an already-removed file is a no-op).
   */
  async purgeExpiredFiles(reports, now = Date.now()) {
    const expired = reports.filter((r) => r.attachments?.length && isPastRetention(r, now));
    let purged = 0;
    for (const report of expired) {
      const { error } = await supabase.storage.from(BUCKET).remove(report.attachments.map((a) => a.path));
      const { error: rpcError } = error
        ? { error }
        : await supabase.rpc("mark_bug_report_files_purged", { p_id: report.id });
      if (rpcError) console.error(`Purging files of bug report ${report.id} failed`, rpcError);
      else purged += 1;
    }
    return purged;
  },
};
