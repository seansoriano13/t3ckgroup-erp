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
  /** Open Venues by default (what the request form offers); `includeInactive` is for Settings. */
  async listVenues({ includeInactive = false } = {}) {
    let query = supabase.from('calendar_venues').select('id, name, active, sort_order');
    if (!includeInactive) query = query.eq('active', true);
    const { data, error } = await query.order('sort_order').order('name');
    if (error) throw error;
    return data ?? [];
  },

  async auditVenue(venue, event, content, actorId, metadata = {}) {
    await systemAuditLogService.addSystemEvent(
      'HR_SETTINGS',
      venue.id,
      content,
      { event, venue: venue.name, ...metadata },
      actorId,
    );
  },

  async addVenue(name, actorId) {
    const label = String(name ?? '').trim();
    if (!label) throw new Error('Give the Venue a name.');
    const { data: last } = await supabase
      .from('calendar_venues')
      .select('sort_order')
      .order('sort_order', { ascending: false })
      .limit(1);
    const sortOrder = (last?.[0]?.sort_order ?? 0) + 1;
    const { data, error } = await supabase
      .from('calendar_venues')
      .insert({ name: label, sort_order: sortOrder })
      .select('id, name, active, sort_order')
      .single();
    if (error) throw new Error(error.code === '23505' ? 'A Venue with that name already exists.' : error.message);
    await this.auditVenue(data, 'VENUE_CREATED', `Added Venue "${label}"`, actorId);
    return data;
  },

  async renameVenue(venue, name, actorId) {
    const label = String(name ?? '').trim();
    if (!label) throw new Error('Give the Venue a name.');
    const { error } = await supabase.from('calendar_venues').update({ name: label }).eq('id', venue.id);
    if (error) throw new Error(error.code === '23505' ? 'A Venue with that name already exists.' : error.message);
    await this.auditVenue({ id: venue.id, name: label }, 'VENUE_RENAMED', `Renamed Venue "${venue.name}" to "${label}"`, actorId, { from: venue.name });
  },

  async setVenueActive(venue, active, actorId) {
    const { error } = await supabase.from('calendar_venues').update({ active }).eq('id', venue.id);
    if (error) throw new Error(error.message);
    await this.auditVenue(
      venue,
      active ? 'VENUE_SWITCHED_ON' : 'VENUE_SWITCHED_OFF',
      `Switched ${active ? 'on' : 'off'} Venue "${venue.name}"`,
      actorId,
    );
  },

  /** `ordered` is the full list in its new order; only Venues whose position changed are written. */
  async reorderVenues(ordered, actorId) {
    const changed = ordered.map((v, i) => ({ v, order: i + 1 })).filter(({ v, order }) => v.sort_order !== order);
    for (const { v, order } of changed) {
      const { error } = await supabase.from('calendar_venues').update({ sort_order: order }).eq('id', v.id);
      if (error) throw new Error(error.message);
    }
    if (changed.length) {
      await this.auditVenue(
        { id: ordered[0].id, name: ordered[0].name },
        'VENUES_REORDERED',
        `Reordered Venues: ${ordered.map((v) => v.name).join(', ')}`,
        actorId,
        { order: ordered.map((v) => v.name) },
      );
    }
  },

  /** A Venue with Meeting Requests is refused by the database; the message tells HR to switch it off instead. */
  async deleteVenue(venue, actorId) {
    const { data, error } = await supabase.from('calendar_venues').delete().eq('id', venue.id).select('id');
    if (error) {
      if (error.code === '23503') throw new Error('This Venue has Meeting Requests, so it cannot be deleted. Switch it off instead.');
      throw new Error(error.message);
    }
    if (!data?.length) throw new Error('Could not delete the Venue.');
    await this.auditVenue(venue, 'VENUE_DELETED', `Deleted Venue "${venue.name}"`, actorId);
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
