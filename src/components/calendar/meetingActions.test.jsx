import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { meetingActions } from './meetingActions.js';
import MeetingActions from './MeetingActions.jsx';

let mockUser = { id: 'ana' };
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));
vi.mock('@/utils/permissions', () => ({
  getPermissionContext: (u) => ({ isHr: Boolean(u?.is_hr), isSuperAdmin: false }),
}));
vi.mock('./MeetingRequestDialog', () => ({ default: () => null }));
vi.mock('@/services/meetingRequestService', () => ({ meetingRequestService: { getRequest: vi.fn(), cancel: vi.fn() } }));

const FUTURE = '2099-01-01T01:00:00.000Z';
const PAST = '2020-01-01T01:00:00.000Z';
const base = { status: 'PENDING_HEAD', startsAt: FUTURE, applicantId: 'ana', viewerId: 'ana' };

describe('meetingActions rules', () => {
  it('lets the applicant edit and cancel a non-final request before it starts', () => {
    for (const status of ['PENDING_HEAD', 'PENDING_HR', 'APPROVED', 'RETURNED']) {
      expect(meetingActions({ ...base, status })).toMatchObject({ edit: true, cancel: true, hrCancel: false });
    }
  });
  it('offers Send again only on a returned request', () => {
    expect(meetingActions({ ...base, status: 'RETURNED' }).resend).toBe(true);
    expect(meetingActions({ ...base, status: 'APPROVED' }).resend).toBe(false);
  });
  it('offers nothing once final', () => {
    for (const status of ['DECLINED', 'CANCELLED']) expect(Object.values(meetingActions({ ...base, status })).some(Boolean)).toBe(false);
  });
  it('still offers the filer Edit and Cancel after the day, but not Send again (#1194)', () => {
    expect(meetingActions({ ...base, startsAt: PAST })).toEqual({ edit: true, resend: false, cancel: true, hrCancel: false });
    expect(meetingActions({ ...base, status: 'RETURNED', startsAt: PAST }).resend).toBe(false);
  });
  it('gives nobody else any right after the day', () => {
    for (const who of [{ viewerId: 'bob' }, { viewerId: 'hr', isHr: true }]) {
      expect(Object.values(meetingActions({ ...base, startsAt: PAST, ...who })).some(Boolean)).toBe(false);
    }
  });
  it('gives HR only Cancel on someone else’s upcoming request', () => {
    expect(meetingActions({ ...base, viewerId: 'hr', isHr: true })).toEqual({ edit: false, resend: false, cancel: false, hrCancel: true });
    expect(Object.values(meetingActions({ ...base, viewerId: 'bob' })).some(Boolean)).toBe(false);
  });
});

function renderActions(request, props) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MeetingActions request={request} {...props} />
    </QueryClientProvider>,
  );
}

describe('MeetingActions', () => {
  const request = { id: 'm1', status: 'RETURNED', startsAt: FUTURE, applicantId: 'ana' };

  it('shows Send again, Edit and Cancel to the applicant of a returned request', () => {
    mockUser = { id: 'ana' };
    renderActions(request);
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows only Cancel to HR on someone else’s request, and nothing to them in My Meeting Requests', () => {
    mockUser = { id: 'hr', is_hr: true };
    const { unmount } = renderActions({ ...request, status: 'APPROVED' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    unmount();
    renderActions({ ...request, status: 'APPROVED' }, { allowHr: false });
    expect(screen.queryByTestId('meeting-actions')).toBeNull();
  });

  it('shows nothing to an ordinary colleague, and the filer still sees Edit and Cancel on a started one', () => {
    mockUser = { id: 'bob' };
    const { unmount } = renderActions(request);
    expect(screen.queryByTestId('meeting-actions')).toBeNull();
    unmount();
    mockUser = { id: 'ana' };
    renderActions({ ...request, startsAt: PAST });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
  });

  it('names the Venue in the cancel question only when the Activity holds one', () => {
    mockUser = { id: 'ana' };
    const { unmount } = renderActions({ ...request, hasVenue: true });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/The Venue is freed at once/)).toBeInTheDocument();
    unmount();
    renderActions({ ...request, hasVenue: false });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText(/It comes off the Calendar at once/)).toBeInTheDocument();
    expect(screen.queryByText(/Venue/)).toBeNull();
  });
});
