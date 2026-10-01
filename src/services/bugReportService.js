import { supabase } from "../lib/supabase";
import { isLocal, isStaging } from "../lib/appEnv";
import { formatBuildFingerprint } from "../utils/buildFingerprint";

const BUCKET = "bug-reports";
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
export const BUG_REPORT_MAX_BYTES = 50 * 1024 * 1024;

/** Whether a report is old enough (a full year) for its files to be deleted. */
export function isPastRetention(report, now = Date.now()) {
  return now - new Date(report.created_at).getTime() > RETENTION_MS;
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
 * Bug Reports (CONTEXT.md). Sending and Resolved go through RPCs; the table
 * itself is readable only by Super Admins and holders of the Bug Reports
 * access right. Files sit in the private `bug-reports` bucket under the
 * sender's employee id, so the page opens them through signed URLs.
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

  /** Every report, newest first. */
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
   * list. Run when the Bug Reports page opens; returns how many were purged.
   */
  async purgeExpiredFiles(reports, now = Date.now()) {
    const expired = reports.filter((r) => r.attachments?.length && isPastRetention(r, now));
    for (const report of expired) {
      const { error } = await supabase.storage.from(BUCKET).remove(report.attachments.map((a) => a.path));
      if (error) throw new Error(error.message);
      const { error: rpcError } = await supabase.rpc("mark_bug_report_files_purged", { p_id: report.id });
      if (rpcError) throw new Error(rpcError.message);
    }
    return expired.length;
  },
};
