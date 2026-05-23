import { describe, it, expect } from 'vitest';
import {
  generateWeeks,
  getCurrentWeekIndex,
  cycleShiftState,
  formatDayShort,
  formatWeekRange,
  addDays,
} from './schedule';

describe('generateWeeks', () => {
  const weeks = generateWeeks();

  it('produces 7 weeks', () => {
    expect(weeks).toHaveLength(7);
  });

  it('first week is Thu May 28 – Wed Jun 3 with 7 days', () => {
    expect(weeks[0]!.start).toBe('2026-05-28');
    expect(weeks[0]!.end).toBe('2026-06-03');
    expect(weeks[0]!.days).toHaveLength(7);
  });

  it('last week is Thu Jul 9 – Thu Jul 16 with 8 days (extra Thursday absorbed)', () => {
    const last = weeks[6]!;
    expect(last.start).toBe('2026-07-09');
    expect(last.end).toBe('2026-07-16');
    expect(last.days).toEqual([
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ]);
  });

  it('every non-final week has 7 days', () => {
    for (let i = 0; i < weeks.length - 1; i += 1) {
      expect(weeks[i]!.days).toHaveLength(7);
    }
  });
});

describe('getCurrentWeekIndex', () => {
  const weeks = generateWeeks();

  it('clamps to first week before schedule', () => {
    expect(getCurrentWeekIndex(new Date('2026-01-01T12:00:00Z'), weeks)).toBe(0);
  });

  it('clamps to last week after schedule', () => {
    expect(getCurrentWeekIndex(new Date('2026-08-01T12:00:00Z'), weeks)).toBe(6);
  });

  it('detects mid-schedule week', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-10T12:00:00Z'), weeks)).toBe(1);
  });

  it('handles the boundary day (Thursday) as start of new week', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-04T12:00:00Z'), weeks)).toBe(1);
  });

  it('handles the last day Jul 16', () => {
    expect(getCurrentWeekIndex(new Date('2026-07-16T12:00:00Z'), weeks)).toBe(6);
  });
});

describe('cycleShiftState', () => {
  it('toggles between can and cant', () => {
    expect(cycleShiftState('can')).toBe('cant');
    expect(cycleShiftState('cant')).toBe('can');
  });
});

describe('formatters', () => {
  it('formats day short', () => {
    expect(formatDayShort('2026-05-28')).toBe('יום חמישי 28/5');
  });

  it('formats week range same month', () => {
    expect(formatWeekRange(generateWeeks()[1]!)).toBe('Jun 4–10');
  });

  it('formats week range cross month', () => {
    expect(formatWeekRange(generateWeeks()[0]!)).toBe('May 28 – Jun 3');
  });
});

describe('addDays', () => {
  it('adds days across month boundary', () => {
    expect(addDays('2026-05-30', 5)).toBe('2026-06-04');
  });
});
