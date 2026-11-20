import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import DealCommissionModal from './DealCommissionModal.jsx';

vi.mock('../../../services/salesFlowService', () => ({
  salesFlowService: {
    getAllStagesIndex: () => Promise.resolve({
      stagesById: { st1: { id: 'st1', flow_id: 'f1', name: 'AWARDED' } },
      flowsById: { f1: { id: 'f1' } },
      stagesByFlow: { f1: [{ id: 'st1', flow_id: 'f1', name: 'AWARDED' }] },
    }),
  },
}));

const access = { user: { id: 'u1' }, canViewAllFinancials: true, canViewSalesAmounts: true, salesPercent: 10 };
const baseDeal = { id: 'd1', sorCode: 'S1', contractValue: 1000, participants: {}, rates: {}, salesRoleShares: [] };

function show(deal) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DealCommissionModal deal={deal} onClose={() => {}} access={access} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DealCommissionModal stage', () => {
  it('shows the flow stage, not the stale status, for a SOR on a Sales Flow', async () => {
    show({ ...baseDeal, status: 'PROPOSAL SUBMITTED', saleTypeId: 'sale1', flowStageId: 'st1' });
    expect(await screen.findByText('AWARDED')).toBeTruthy();
    expect(screen.queryByText(/PROPOSAL SUBMITTED/i)).toBeNull();
  });

  it('shows the status for a SOR with no Sale Type', () => {
    show({ ...baseDeal, status: 'PROPOSAL SUBMITTED', saleTypeId: null, flowStageId: null });
    expect(screen.getByText(/PROPOSAL SUBMITTED/i)).toBeTruthy();
  });
});
