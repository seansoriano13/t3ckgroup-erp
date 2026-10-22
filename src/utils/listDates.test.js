import { describe, expect, it } from 'vitest'
import { listAge, listAgeDays, listDate } from './listDates.js'

// Oct 22 2026, 10:00 in Manila.
const NOW = new Date('2026-10-22T02:00:00Z')

describe('listAge', () => {
  it('reads whole days as "Nd"', () => {
    expect(listAge('2026-10-19T02:00:00Z', NOW)).toBe('3d')
    expect(listAge('2026-10-22T01:00:00Z', NOW)).toBe('0d')
  })

  it('counts Manila days: midnight to 8 AM Manila is already the new day', () => {
    // 00:30 Manila on Oct 22 is Oct 21 in UTC; it is today, so 0d.
    expect(listAge('2026-10-21T16:30:00Z', NOW)).toBe('0d')
    // 23:30 Manila on Oct 21 is yesterday, even though it was only 10.5 hours ago.
    expect(listAge('2026-10-21T15:30:00Z', NOW)).toBe('1d')
    // Seen at 07:00 Manila on Oct 22, a row made at 23:00 Manila the day before is 1d.
    expect(listAge('2026-10-21T15:00:00Z', new Date('2026-10-21T23:00:00Z'))).toBe('1d')
  })

  it('is blank without a date and never negative', () => {
    expect(listAge(null, NOW)).toBe('')
    expect(listAgeDays('2026-10-25T00:00:00Z', NOW)).toBe(0)
  })
})

describe('listDate', () => {
  it('drops the year for a date this year', () => {
    expect(listDate('2026-10-22T02:00:00Z', NOW)).toBe('Oct 22')
  })

  it('keeps the year for a date in another year', () => {
    expect(listDate('2025-10-22T02:00:00Z', NOW)).toBe('Oct 22, 2025')
  })

  it('reads the Manila date, not the UTC one, between midnight and 8 AM', () => {
    // 00:30 Manila on Oct 22 is still Oct 21 in UTC.
    expect(listDate('2026-10-21T16:30:00Z', NOW)).toBe('Oct 22')
    // 00:30 Manila on Jan 1 2026 is Dec 31 2025 in UTC: it belongs to 2026.
    expect(listDate('2025-12-31T16:30:00Z', NOW)).toBe('Jan 1')
  })

  it('takes a plain date as it is', () => {
    expect(listDate('2026-10-01', NOW)).toBe('Oct 1')
  })

  it('is blank without a date', () => {
    expect(listDate(null, NOW)).toBe('')
  })
})
