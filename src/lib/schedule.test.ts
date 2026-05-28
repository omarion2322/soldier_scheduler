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

  it('second week is the Jun 4 – Jun 13 bridge (10 days, realigning to Sun-Sat)', () => {
    expect(weeks[1]!.start).toBe('2026-06-04');
    expect(weeks[1]!.end).toBe('2026-06-13');
    expect(weeks[1]!.days).toHaveLength(10);
  });

  it('week 3 onward follows Sun-Sat cadence', () => {
    expect(weeks[2]!.start).toBe('2026-06-14');
    expect(weeks[2]!.end).toBe('2026-06-20');
    expect(weeks[3]!.start).toBe('2026-06-21');
    expect(weeks[3]!.end).toBe('2026-06-27');
  });

  it('last week is the Sun Jul 12 – Thu Jul 16 5-day tail', () => {
    const last = weeks[weeks.length - 1]!;
    expect(last.start).toBe('2026-07-12');
    expect(last.end).toBe('2026-07-16');
    expect(last.days).toEqual([
      '2026-07-12',
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ]);
  });

  it('every week except the bridge and the tail has 7 days', () => {
    weeks.forEach((w, i) => {
      if (i === 1) return; // bridge: 10 days
      if (i === weeks.length - 1) return; // tail: 5 days
      expect(w.days).toHaveLength(7);
    });
  });
});

describe('getCurrentWeekIndex', () => {
  const weeks = generateWeeks();

  it('clamps to first week before schedule', () => {
    expect(getCurrentWeekIndex(new Date('2026-01-01T12:00:00Z'), weeks)).toBe(0);
  });

  it('clamps to last week after schedule', () => {
    expect(getCurrentWeekIndex(new Date('2026-08-01T12:00:00Z'), weeks)).toBe(weeks.length - 1);
  });

  it('detects mid-bridge-week (Jun 10) as week 2', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-10T12:00:00Z'), weeks)).toBe(1);
  });

  it('Jun 14 is the start of week 3 (first Sun-Sat week)', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-14T12:00:00Z'), weeks)).toBe(2);
  });

  it('handles the boundary day (Thursday Jun 4) as start of bridge week', () => {
    expect(getCurrentWeekIndex(new Date('2026-06-04T12:00:00Z'), weeks)).toBe(1);
  });

  it('handles the last day Jul 16', () => {
    expect(getCurrentWeekIndex(new Date('2026-07-16T12:00:00Z'), weeks)).toBe(weeks.length - 1);
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
    expect(formatWeekRange(generateWeeks()[1]!)).toBe('Jun 4–13');
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
