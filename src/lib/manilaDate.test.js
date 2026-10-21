import { describe, expect, it } from 'vitest'
import {
  dayGrid,
  isFifteenMinuteStep,
  isSameManilaDay,
  manilaDate,
  manilaTime,
  manilaToday,
  monthGrid,
  weekGrid,
} from './manilaDate.js'

describe('manilaDate', () => {
  it('reads 07:00 Manila as the same Manila day, not yesterday', () => {
    const instant = new Date('2026-10-20T23:00:00Z') // 07:00 on the 21st in Manila
    expect(manilaToday(instant)).toBe('2026-10-21')
    expect(manilaDate(instant)).toBe('2026-10-21')
    expect(manilaTime(instant)).toBe('07:00')
  })

  it('flips at Manila midnight', () => {
    expect(manilaToday(new Date('2026-10-20T15:59:59Z'))).toBe('2026-10-20')
    expect(manilaToday(new Date('2026-10-20T16:00:00Z'))).toBe('2026-10-21')
  })

  it('builds a Monday-first week', () => {
    const week = weekGrid('2026-10-21') // a Wednesday
    expect(week).toHaveLength(7)
    expect(manilaDate(week[0])).toBe('2026-10-19')
    expect(manilaDate(week[6])).toBe('2026-10-25')
  })

  it('builds a month grid that spans two months', () => {
    const grid = monthGrid('2026-10-15')
    expect(manilaDate(grid[0])).toBe('2026-09-28')
    expect(manilaDate(grid[grid.length - 1])).toBe('2026-11-01')
    expect(grid.length % 7).toBe(0)
  })

  it('builds a one-day grid and compares days', () => {
    expect(dayGrid('2026-10-21').map(manilaDate)).toEqual(['2026-10-21'])
    expect(isSameManilaDay(new Date('2026-10-20T16:00:00Z'), new Date('2026-10-21T10:00:00Z'))).toBe(true)
    expect(isSameManilaDay(new Date('2026-10-20T15:00:00Z'), new Date('2026-10-20T16:00:00Z'))).toBe(false)
  })

  it('checks 15-minute steps', () => {
    expect(isFifteenMinuteStep('09:00')).toBe(true)
    expect(isFifteenMinuteStep('09:45')).toBe(true)
    expect(isFifteenMinuteStep('09:10')).toBe(false)
    expect(isFifteenMinuteStep('nope')).toBe(false)
  })
})
