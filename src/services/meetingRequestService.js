import { supabase } from '../lib/supabase';
import { notificationService } from './notificationService';
import { systemAuditLogService } from './systemAuditLogService';
import { formatManilaDateTime, manilaTime } from '../lib/manilaDate.js';

/**
 * Meeting Requests (#619, spec #609, ADR 0038).
 *
 * Writes go through database functions only (`file_meeting_request`, and the
 * decision functions later tickets add). The service never inserts into the
 * tables itself, and turns the database's double-booking refusal into a plain
 * message naming the request that holds the slot.
 */

export const MEETING_STATUS = {
  PENDING_HEAD: 'PENDING_HEAD',
  PENDING_HR: 'PENDING_HR',
  RETURNED: 'RETURNED',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  CANCELLED: 'CANCELLED',
};

export const MEETING_STATUS_LABEL = {
  PENDING_HEAD: 'Waiting for head',
  PENDING_HR: 'Waiting for HR',
  RETURNED: 'Returned',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  CANCELLED: 'Cancelled',
};

const EXCLUSION_VIOLATION = '23P01';
const REQUEST_SELECT = `*,
  venue:calendar_venues(id, name),
  applicant:employees!meeting_requests_applicant_id_fkey(id, name, department),
  facilitator:employees!meeting_requests_facilitator_id_fkey(id, name),
  participants:meeting_request_participants(employee_id, employee:employees(id, name))`;

const timeRange = (startsAt, endsAt) => `${manilaTime(startsAt)} to ${manilaTime(endsAt)}`;

async function describeHolder({ venueId, startsAt, endsAt }) {
  const { data } = await supabase.rpc('meeting_request_holder', {
    p_venue_id: venueId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  const holder = Array.isArray(data) ? data[0] : data;
  if (!holder) return 'That Venue is already booked at that time. Pick another time.';
  return (
    `${holder.venue_name ?? 'That Venue'} is already held ${timeRange(holder.starts_at, holder.ends_at)} ` +
    `for "${holder.purpose}" (requested by ${holder.applicant_name}). Pick another time.`
  );
}

export const meetingRequestService = {
  async listVenues() {
    const { data, error } = await supabase
      .from('calendar_venues')
      .select('id, name, active, sort_order')
      .eq('active', true)
      .order('sort_order');
    if (error) throw error;
    return data ?? [];
  },

  /** The applicant's most recent request's Facilitator and Venue, or null when there is none. */
  async lastPicks(applicantId) {
    const { data, error } = await supabase
      .from('meeting_requests')
      .select('facilitator_id, venue_id')
      .eq('applicant_id', applicantId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const row = data?.[0];
    return row ? { facilitatorId: row.facilitator_id, venueId: row.venue_id } : null;
  },

  /**
   * Files a Meeting Request. `startsAt` / `endsAt` are ISO instants (the form builds
   * them from a Manila date and times). Returns the saved request.
   */
  async fileRequest({ venueId, startsAt, endsAt, facilitatorId, purpose, guests = [], participantIds = [], headId = null, applicant }) {
    const { data: id, error } = await supabase.rpc('file_meeting_request', {
      p_venue_id: venueId,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
      p_facilitator_id: facilitatorId,
      p_purpose: purpose,
      p_guests: guests,
      p_participant_ids: participantIds,
      p_head_id: headId,
    });
    if (error) {
      if (error.code === EXCLUSION_VIOLATION) {
        throw new Error(await describeHolder({ venueId, startsAt, endsAt }));
      }
      throw new Error(error.message);
    }

    const request = await this.getRequest(id);
    await this.afterFiled(request, applicant);
    return request;
  },

  /** Audit line plus the notification for whoever approves next. */
  async afterFiled(request, applicant) {
    const applicantName = applicant?.name ?? request.applicant?.name ?? 'An employee';
    const when = `${formatManilaDateTime(request.starts_at)} to ${manilaTime(request.ends_at)}`;
    const venue = request.venue?.name ?? 'a Venue';
    const toHr = request.status === MEETING_STATUS.PENDING_HR;

    const note = {
      type: 'MEETING_REQUEST',
      title: 'Meeting Request awaiting approval',
      message: `${applicantName} requested ${venue}, ${when}: ${request.purpose}`,
      reference_id: request.id,
      sender_id: request.applicant_id,
    };
    if (toHr) await notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], note);
    else if (request.head_id) await notificationService.createNotification({ ...note, recipient_id: request.head_id });

    await this.mirrorEvent({
      request,
      action: 'FILED',
      content: `${applicantName} filed a Meeting Request for ${venue}, ${when}`,
      authorId: request.applicant_id,
      metadata: { event: 'MEETING_REQUEST_FILED', status: request.status },
    });
  },

  /** Every event is also written to the system audit log under MEETING_REQUEST (shown in HR's Activity Log). */
  async mirrorEvent({ request, action, content, authorId, metadata = {} }) {
    await systemAuditLogService.addSystemEvent(
      'MEETING_REQUEST',
      request.id,
      content,
      { action, ...metadata },
      authorId,
    );
  },

  /** One request with its Venue, people and history. */
  async getRequest(id) {
    const { data, error } = await supabase.from('meeting_requests').select(REQUEST_SELECT).eq('id', id).single();
    if (error) throw new Error(error.message);
    const { data: events, error: eventsError } = await supabase
      .from('meeting_request_events')
      .select('*, actor:employees(id, name)')
      .eq('request_id', id)
      .order('created_at');
    if (eventsError) throw new Error(eventsError.message);
    return { ...data, events: events ?? [] };
  },

  /** Requests where the employee is the applicant, the Facilitator or a Participant, newest first. */
  async listMine(employeeId) {
    const { data: asParticipant, error: pErr } = await supabase
      .from('meeting_request_participants')
      .select('request_id')
      .eq('employee_id', employeeId);
    if (pErr) throw new Error(pErr.message);

    const [applied, facilitated, invited] = await Promise.all([
      supabase.from('meeting_requests').select(REQUEST_SELECT).eq('applicant_id', employeeId),
      supabase.from('meeting_requests').select(REQUEST_SELECT).eq('facilitator_id', employeeId),
      (asParticipant ?? []).length
        ? supabase.from('meeting_requests').select(REQUEST_SELECT).in('id', asParticipant.map((p) => p.request_id))
        : Promise.resolve({ data: [], error: null }),
    ]);
    for (const r of [applied, facilitated, invited]) if (r.error) throw new Error(r.error.message);

    const byId = new Map();
    for (const row of [...applied.data, ...facilitated.data, ...invited.data]) byId.set(row.id, row);
    return [...byId.values()].sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
  },
};
