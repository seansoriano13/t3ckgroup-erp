import { describe, expect, it } from 'vitest';
import { deriveRequestStage } from './requestStage';

describe('deriveRequestStage', () => {
  it('is SUBMITTED when nothing has been routed yet', () => {
    expect(deriveRequestStage({ status: 'PENDING', head_id: null, head_status: 'PENDING' }))
      .toMatchObject({ key: 'SUBMITTED' });
  });

  it('names the head it is waiting on', () => {
    const stage = deriveRequestStage({
      status: 'PENDING',
      head_id: 'head-1',
      head_status: 'PENDING',
      head: { id: 'head-1', name: 'Jane Head' },
    });
    expect(stage).toMatchObject({ key: 'WAITING_ON_HEAD', waitingOn: 'Jane Head' });
  });

  it('is WITH_HR once the head has approved', () => {
    expect(deriveRequestStage({ status: 'PENDING', head_id: 'head-1', head_status: 'APPROVED' }))
      .toMatchObject({ key: 'WITH_HR' });
  });

  it('is WITH_HR when HR has overridden a still-pending head decision', () => {
    expect(deriveRequestStage({ status: 'PENDING', head_id: 'head-1', head_status: 'PENDING', hr_override: true }))
      .toMatchObject({ key: 'WITH_HR' });
  });

  it('is WITH_HR when HR overrides a head decision that was rejected', () => {
    expect(deriveRequestStage({ status: 'PENDING', head_id: 'head-1', head_status: 'REJECTED', hr_override: true }))
      .toMatchObject({ key: 'WITH_HR' });
  });

  it('is a terminal DECIDED, with the note, when the head declines', () => {
    const stage = deriveRequestStage({
      status: 'PENDING',
      head_id: 'head-1',
      head_status: 'REJECTED',
      head_note: 'Short-staffed that week',
    });
    expect(stage).toMatchObject({ key: 'DECIDED', label: 'Declined by head', note: 'Short-staffed that week' });
  });

  it('is DECIDED when withdrawn, even after the head had approved', () => {
    expect(deriveRequestStage({ status: 'CANCELLED', head_id: 'head-1', head_status: 'APPROVED' }))
      .toMatchObject({ key: 'DECIDED', label: 'Withdrawn' });
  });

  it('is DECIDED when HR rejects', () => {
    const stage = deriveRequestStage({ status: 'REJECTED', hr_notes: 'Balance insufficient' });
    expect(stage).toMatchObject({ key: 'DECIDED', label: 'Declined by HR', note: 'Balance insufficient' });
  });

  it('is DECIDED (approved, not yet processed) once HR approves but printing has not happened', () => {
    expect(deriveRequestStage({ status: 'APPROVED', printed_at: null }))
      .toMatchObject({ key: 'DECIDED', label: 'Approved' });
  });

  it('is PRINTED once the form has been printed', () => {
    expect(deriveRequestStage({ status: 'APPROVED_OFFSET', printed_at: '2026-03-01T00:00:00Z' }))
      .toMatchObject({ key: 'PRINTED' });
  });

  it('treats a row with no head_status column (pre-#137 data) as already cleared for HR', () => {
    expect(deriveRequestStage({ status: 'PENDING' })).toMatchObject({ key: 'WITH_HR' });
  });
});
