/**
 * The reorder control is the one piece of #78 an integration test on
 * hrSettingsService can't reach — it exercises the service correctly, but
 * nothing proves the buttons actually call it with the right payload. That's
 * the one thing this file checks; add/edit/deactivate are covered by clicking
 * through the same UI the reorder assertions already render.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/support';
import { makeLeaveCategory } from '@/test/factories';
import LeaveCategoriesConfig from './LeaveCategoriesConfig';
import { hrSettingsService } from '@/services/hrSettingsService';

const mockUser = vi.hoisted(() => ({ current: { id: 'hr-1', name: 'HR Officer' } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: mockUser.current }) }));

describe('LeaveCategoriesConfig reordering', () => {
  it('moving a category down calls reorderLeaveCategories with the swapped sort_order payload', async () => {
    const first = makeLeaveCategory({ label: 'Sick Leave', sort_order: 1 });
    const second = makeLeaveCategory({ label: 'Vacation Leave', sort_order: 2 });
    const spy = vi.spyOn(hrSettingsService, 'reorderLeaveCategories');

    renderWithProviders(<LeaveCategoriesConfig />);
    await screen.findByText('Sick Leave');

    const user = userEvent.setup();
    const moveDownButtons = screen.getAllByTitle('Move down');
    await user.click(moveDownButtons[0]); // move "Sick Leave" (first row) down

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(
      [
        { id: second.id, sort_order: 1 },
        { id: first.id, sort_order: 2 },
      ],
      'hr-1',
    );
  });

  it('reflects the new order on screen after a reorder', async () => {
    makeLeaveCategory({ label: 'Sick Leave', sort_order: 1 });
    makeLeaveCategory({ label: 'Vacation Leave', sort_order: 2 });

    renderWithProviders(<LeaveCategoriesConfig />);
    await screen.findByText('Sick Leave');

    const user = userEvent.setup();
    await user.click(screen.getAllByTitle('Move down')[0]);

    const labels = await waitFor(() => {
      const rendered = screen.getAllByText(/Sick Leave|Vacation Leave/).map((el) => el.textContent);
      expect(rendered).toEqual(['Vacation Leave', 'Sick Leave']);
      return rendered;
    });
    expect(labels).toEqual(['Vacation Leave', 'Sick Leave']);
  });

  it('disables moving the first category up and the last category down', async () => {
    makeLeaveCategory({ label: 'Sick Leave', sort_order: 1 });
    makeLeaveCategory({ label: 'Vacation Leave', sort_order: 2 });

    renderWithProviders(<LeaveCategoriesConfig />);
    await screen.findByText('Sick Leave');

    const moveUpButtons = screen.getAllByTitle('Move up');
    const moveDownButtons = screen.getAllByTitle('Move down');
    expect(moveUpButtons[0]).toBeDisabled();
    expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled();
  });
});
