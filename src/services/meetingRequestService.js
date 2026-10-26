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

const DECISION_VERB = {
  HEAD_APPROVED: 'approved as department head',
  HEAD_DECLINED: 'declined',
  HEAD_RETURNED: 'returned',
  HR_APPROVED: 'approved',
  HR_DECLINED: 'declined',
  HR_RETURNED: 'returned',
  HR_OVERRIDE: 'skipped the head step on',
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

  /**
   * Requests waiting on the signed-in person's step (#624). A head sees the PENDING_HEAD ones
   * routed to them; HR and Super Admins see PENDING_HR plus every PENDING_HEAD (which they may
   * override). Nobody is shown their own request.
   */
  async listPendingForApprover({ employeeId, isHr = false, isSuperAdmin = false } = {}) {
    let query = supabase.from('meeting_requests').select(REQUEST_SELECT).order('created_at');
    if (isHr || isSuperAdmin) query = query.in('status', [MEETING_STATUS.PENDING_HEAD, MEETING_STATUS.PENDING_HR]);
    else query = query.eq('status', MEETING_STATUS.PENDING_HEAD).eq('head_id', employeeId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []).filter((r) => r.applicant_id !== employeeId);
  },

  /** The count behind the sidebar badge (same filter as the queue). */
  async countPendingForApprover(args) {
    return (await this.listPendingForApprover(args)).length;
  },

  /**
   * Applicant edit before the start (#628). Pending-HR and approved requests go back to the head;
   * the head is told, and the Facilitator and Participants when it was approved.
   */
  async editRequest({ requestId, venueId, startsAt, endsAt, facilitatorId, purpose, guests = [], participantIds = [], headId = null, actor }) {
    const { data, error } = await supabase.rpc('edit_meeting_request', {
      p_request_id: requestId,
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
      if (error.code === EXCLUSION_VIOLATION) throw new Error(await describeHolder({ venueId, startsAt, endsAt }));
      throw new Error(error.message);
    }
    await this.afterChange(data, { actor });
    return data;
  },

  /** Applicant sends a returned request again. */
  async resend({ requestId, actor }) {
    const { data, error } = await supabase.rpc('resend_meeting_request', { p_request_id: requestId });
    if (error) throw new Error(error.message);
    await this.afterChange(data, { actor });
    return data;
  },

  /** The applicant cancels (reason optional); HR / Super Admin cancel with a required reason. */
  async cancel({ requestId, reason = '', actor }) {
    const { data, error } = await supabase.rpc('cancel_meeting_request', {
      p_request_id: requestId,
      p_reason: reason || null,
    });
    if (error) throw new Error(error.message);
    await this.afterChange(data, { note: reason, actor });
    return data;
  },

  /**
   * Notifications and the audit line for an edit, a resend or a cancel (the event row was written
   * by the database).
   *   - the head, when it lands back with them (HR when it lands at the HR step)
   *   - the Facilitator and Participants, when an approved request is changed or cancelled
   *   - the applicant, when HR cancels
   */
  async afterChange(result, { note = '', actor } = {}) {
    const request = await this.getRequest(result.id);
    const venue = request.venue?.name ?? 'a Venue';
    const when = `${formatManilaDateTime(request.starts_at)} to ${manilaTime(request.ends_at)}`;
    const actorName = actor?.name ?? 'Someone';
    const senderId = actor?.id ?? null;
    const cancelled = result.to_status === MEETING_STATUS.CANCELLED;
    const wasApproved = result.from_status === MEETING_STATUS.APPROVED;
    const changed = Object.keys(result.changed_fields ?? {});
    const withNote = note ? ` Reason: ${note}` : '';

    if (!cancelled && [MEETING_STATUS.PENDING_HEAD, MEETING_STATUS.PENDING_HR].includes(result.to_status) && result.to_status !== result.from_status) {
      const message = `${actorName} ${result.action === 'RESENT' ? 'sent again' : 'changed'}: ${venue}, ${when}: ${request.purpose}`;
      const base = { type: 'MEETING_REQUEST', title: 'Meeting Request back for approval', message, reference_id: request.id, sender_id: senderId };
      if (result.to_status === MEETING_STATUS.PENDING_HR) await notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], base);
      else if (request.head_id) await notificationService.createNotification({ ...base, recipient_id: request.head_id });
    }

    if (wasApproved && (cancelled || result.action === 'EDITED')) {
      const invited = new Set([
        request.facilitator_id,
        result.old_facilitator_id,
        ...(request.participants ?? []).map((p) => p.employee_id),
        ...(result.old_participant_ids ?? []),
      ]);
      invited.delete(request.applicant_id);
      invited.delete(null);
      invited.delete(undefined);
      for (const recipient_id of invited) {
        await notificationService.createNotification({
          recipient_id,
          sender_id: senderId,
          type: cancelled ? 'MEETING_CANCELLED' : 'MEETING_CHANGED',
          title: cancelled ? 'Meeting cancelled' : 'Meeting changed',
          message: `${venue}, ${when}: ${request.purpose}.${withNote}`,
          reference_id: request.id,
        });
      }
    }

    if (result.action === 'HR_CANCELLED') {
      await notificationService.createNotification({
        recipient_id: request.applicant_id,
        sender_id: senderId,
        type: 'MEETING_REQUEST_DECISION',
        title: 'Meeting Request cancelled by HR',
        message: `${actorName} cancelled your Meeting Request for ${venue}, ${when}.${withNote}`,
        reference_id: request.id,
      });
    }

    const verb = { EDITED: 'edited', RESENT: 'sent again', CANCELLED: 'cancelled', HR_CANCELLED: 'cancelled' }[result.action] ?? 'updated';
    await this.mirrorEvent({
      request,
      action: result.action,
      content: `${actorName} ${verb} the Meeting Request for ${venue}, ${when}.${withNote}${changed.length ? ` Changed: ${changed.join(', ')}.` : ''}`,
      authorId: senderId,
      metadata: {
        event: `MEETING_REQUEST_${result.action}`,
        from: result.from_status,
        to: result.to_status,
        changed_fields: result.changed_fields ?? null,
        note: note || null,
      },
    });
  },

  /** decision: 'APPROVE' | 'DECLINE' | 'RETURN'. Decline and return need a note. */
  async decide({ requestId, decision, note = '', actor }) {
    const { data, error } = await supabase.rpc('decide_meeting_request', {
      p_request_id: requestId,
      p_decision: decision,
      p_note: note || null,
    });
    if (error) throw new Error(error.message);
    await this.afterDecision(data, { note, actor });
    return data;
  },

  /** HR skips a pending head step. A reason is required. */
  async overrideHead({ requestId, reason, actor }) {
    const { data, error } = await supabase.rpc('override_meeting_request_head', {
      p_request_id: requestId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    await this.afterDecision(data, { note: reason, actor });
    return data;
  },

  /**
   * Notifications and the audit line for one transition. The event row was written by the database;
   * this mirrors it into the system audit log under MEETING_REQUEST.
   *   - HR, when it reaches the HR step
   *   - the applicant, on every decision and return
   *   - the Facilitator and Participants, when it is approved
   */
  async afterDecision(result, { note = '', actor } = {}) {
    const request = await this.getRequest(result.id);
    const venue = request.venue?.name ?? 'a Venue';
    const when = `${formatManilaDateTime(request.starts_at)} to ${manilaTime(request.ends_at)}`;
    const actorName = actor?.name ?? 'Someone';
    const senderId = actor?.id ?? null;
    const verb = DECISION_VERB[result.action] ?? 'updated';
    const withNote = note ? ` Note: ${note}` : '';

    if (result.to_status === MEETING_STATUS.PENDING_HR) {
      await notificationService.broadcastToRole(['HR', 'SUPER_ADMIN'], {
        type: 'MEETING_REQUEST',
        title: 'Meeting Request awaiting HR',
        message: `${request.applicant?.name ?? 'An employee'} requested ${venue}, ${when}: ${request.purpose}`,
        reference_id: request.id,
        sender_id: senderId,
      });
    }

    await notificationService.createNotification({
      recipient_id: request.applicant_id,
      sender_id: senderId,
      type: 'MEETING_REQUEST_DECISION',
      title: `Meeting Request ${MEETING_STATUS_LABEL[result.to_status]?.toLowerCase() ?? 'updated'}`,
      message: `${actorName} ${verb} your Meeting Request for ${venue}, ${when}.${withNote}`,
      reference_id: request.id,
    });

    if (result.to_status === MEETING_STATUS.APPROVED) {
      const invited = new Set([request.facilitator_id, ...(request.participants ?? []).map((p) => p.employee_id)]);
      invited.delete(request.applicant_id);
      for (const recipient_id of invited) {
        await notificationService.createNotification({
          recipient_id,
          sender_id: senderId,
          type: 'MEETING_APPROVED',
          title: 'Meeting approved',
          message: `${venue}, ${when}: ${request.purpose}`,
          reference_id: request.id,
        });
      }
    }

    await this.mirrorEvent({
      request,
      action: result.action,
      content: `${actorName} ${verb} the Meeting Request for ${venue}, ${when}.${withNote}`,
      authorId: senderId,
      metadata: { event: `MEETING_REQUEST_${result.action}`, from: result.from_status, to: result.to_status, note: note || null },
    });
  },
};
