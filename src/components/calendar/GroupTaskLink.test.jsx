import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GroupTaskLink from './GroupTaskLink.jsx';

const mockOpenable = vi.fn();
vi.mock('@/services/meetingRequestService', () => ({ meetingRequestService: { groupTaskOpenable: (...a) => mockOpenable(...a) } }));
const mockOpen = vi.fn();
vi.mock('@/utils/recordLink', () => ({ openRecordWindow: (...a) => mockOpen(...a) }));

const renderLink = (id) => render(<QueryClientProvider client={new QueryClient()}><GroupTaskLink groupTaskId={id} /></QueryClientProvider>);

describe('GroupTaskLink', () => {
  beforeEach(() => { mockOpenable.mockReset(); mockOpen.mockReset(); });

  it('lets a viewer who can read the Group Task open its window', async () => {
    mockOpenable.mockResolvedValue(true);
    renderLink('t1');
    fireEvent.click(await screen.findByRole('button', { name: 'Open Group Task' }));
    expect(mockOpen).toHaveBeenCalledWith({ id: 't1', type: 'GROUP_TASK' });
  });
  it('shows no link when the viewer cannot read the Group Task', async () => {
    mockOpenable.mockResolvedValue(false);
    renderLink('t1');
    await waitFor(() => expect(mockOpenable).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Open Group Task' })).toBeNull();
  });
  it('asks nothing and shows nothing for an ordinary Activity', () => {
    renderLink(null);
    expect(mockOpenable).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
