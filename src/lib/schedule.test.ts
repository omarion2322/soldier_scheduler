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

  it('produces 8 weeks', () => {
    expect(weeks).toHaveLength(8);
  });

  it('first week is Tue May 26 – Mon Jun 1 with 7 days', () => {
    expect(weeks[0]!.start).toBe('2026-05-26');
    expect(weeks[0]!.end).toBe('2026-06-01');
    expect(weeks[0]!.days).toHaveLength(7);
  });

  it('last week is partial Tue Jul 14 – Sat Jul 18 with 5 days', () => {
    const last = weeks[7]!;
    expect(last.start).toBe('2026-07-14');
    expect(last.end).toBe('2026-07-18');
    expect(last.days).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
      '2026-07-17',
      '2026-07-18',
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
    expect(getCurrentWeekIndex(new Date('2026-08-01T12:00:00Z'), weeks)).toBe(7);
  });

  it('detects mid-schedule week', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-10T12:00:00Z'), weeks)).toBe(2);
  });

  it('handles the boundary day (Tuesday) as start of new week', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-02T12:00:00Z'), weeks)).toBe(1);
  });

  it('handles the last day Jul 18', () => {
    expect(getCurrentWeekIndex(new Date('2026-07-18T12:00:00Z'), weeks)).toBe(7);
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
    expect(formatDayShort('2026-05-26')).toBe('Tue May 26');
  });

  it('formats week range same month', () => {
    expect(formatWeekRange(generateWeeks()[1]!)).toBe('Jun 2–8');
  });

  it('formats week range cross month', () => {
    expect(formatWeekRange(generateWeeks()[0]!)).toBe('May 26 – Jun 1');
  });
});

describe('addDays', () => {
  it('adds days across month boundary', () => {
    expect(addDays('2026-05-30', 5)).toBe('2026-06-04');
  });
});
