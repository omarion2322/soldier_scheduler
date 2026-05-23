import { describe, it, expect } from 'vitest';
import { generateSchedule, type SchedulerSoldier } from './scheduler';
import type { DayShifts } from './types';

function allCan(): DayShifts {
  return { morning: 'can', afternoon: 'can', night: 'can' };
}

function availability(days: string[], states?: Partial<Record<string, DayShifts>>): Record<string, DayShifts> {
  const out: Record<string, DayShifts> = {};
  for (const d of days) out[d] = states?.[d] ?? allCan();
  return out;
}

function makeSoldier(
  phone: string,
  name: string,
  position: 'mefaked_haml' | 'sambatz',
  days: string[],
  states?: Partial<Record<string, DayShifts>>,
): SchedulerSoldier {
  return { phone, name, position, availability: availability(days, states) };
}

describe('generateSchedule', () => {
  const DAYS = ['2026-05-28', '2026-05-29', '2026-05-30'];

  it('produces required composition for each slot when staffing is sufficient', () => {
    const soldiers: SchedulerSoldier[] = [];
    for (let i = 0; i < 5; i += 1) {
      soldiers.push(makeSoldier(`m${i}`, `M${i}`, 'mefaked_haml', DAYS));
    }
    for (let i = 0; i < 8; i += 1) {
      soldiers.push(makeSoldier(`s${i}`, `S${i}`, 'sambatz', DAYS));
    }

    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null });
    expect(res.unfilled).toEqual([]);
    expect(res.warnings).toEqual([]);
    for (const d of DAYS) {
      expect(res.assignments[d]!.morning.mefaked_haml).toHaveLength(1);
      expect(res.assignments[d]!.morning.sambatz).toHaveLength(2);
      expect(res.assignments[d]!.afternoon.mefaked_haml).toHaveLength(1);
      expect(res.assignments[d]!.afternoon.sambatz).toHaveLength(2);
      expect(res.assignments[d]!.night.mefaked_haml).toHaveLength(1);
      expect(res.assignments[d]!.night.sambatz).toHaveLength(1);
    }
  });

  it('enforces a 2-shift rest gap between assignments', () => {
    const soldiers: SchedulerSoldier[] = [];
    for (let i = 0; i < 4; i += 1) soldiers.push(makeSoldier(`m${i}`, `M${i}`, 'mefaked_haml', DAYS));
    for (let i = 0; i < 6; i += 1) soldiers.push(makeSoldier(`s${i}`, `S${i}`, 'sambatz', DAYS));

    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null });
    // Walk all assignments in order and verify no soldier appears within 2 shifts (strict).
    const last: Record<string, number> = {};
    let idx = 0;
    for (const d of DAYS) {
      for (const slot of ['morning', 'afternoon', 'night'] as const) {
        const all = [
          ...res.assignments[d]![slot].mefaked_haml,
          ...res.assignments[d]![slot].sambatz,
        ];
        for (const name of all) {
          if (last[name] !== undefined) {
            expect(idx - last[name]!).toBeGreaterThanOrEqual(3);
          }
          last[name] = idx;
        }
        idx += 1;
      }
    }
  });

  it('relaxes the gap to 1 when otherwise unfilled', () => {
    // 1 mefaked, 2 sambatz: with strict gap=2 a single sambatz can only fill 1 of 2 needed at first slot.
    // Force a single sambatz scenario by giving only one available sambatz on the first day.
    const soldiers: SchedulerSoldier[] = [
      makeSoldier('m1', 'M1', 'mefaked_haml', DAYS),
      makeSoldier('m2', 'M2', 'mefaked_haml', DAYS),
      makeSoldier('s1', 'S1', 'sambatz', DAYS),
      makeSoldier('s2', 'S2', 'sambatz', DAYS, {
        '2026-05-28': { morning: 'cant', afternoon: 'can', night: 'can' },
      }),
    ];
    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null });
    // We expect a relaxed-gap warning since S1 must repeat with shorter gap.
    expect(res.warnings.some((w) => /relaxed rest gap/.test(w))).toBe(true);
  });

  it('honors prev-day assignments by blocking the same soldier in early shifts', () => {
    const soldiers: SchedulerSoldier[] = [
      makeSoldier('m1', 'Alice', 'mefaked_haml', DAYS),
      makeSoldier('m2', 'Bob', 'mefaked_haml', DAYS),
      makeSoldier('s1', 'Carol', 'sambatz', DAYS),
      makeSoldier('s2', 'Dan', 'sambatz', DAYS),
      makeSoldier('s3', 'Eve', 'sambatz', DAYS),
    ];
    const prevDay = {
      morning: { mefaked_haml: [], sambatz: [] },
      afternoon: { mefaked_haml: [], sambatz: [] },
      night: { mefaked_haml: ['Alice'], sambatz: ['Carol'] },
    };
    const res = generateSchedule({ days: DAYS, soldiers, prevDay });
    // Alice and Carol were on night previous day (gap idx -1). They must not appear in morning (idx 0) — strict gap needs >=3.
    const morning = res.assignments[DAYS[0]!]!.morning;
    expect(morning.mefaked_haml).not.toContain('Alice');
    expect(morning.sambatz).not.toContain('Carol');
  });

  it('balances assignment counts across soldiers', () => {
    const soldiers: SchedulerSoldier[] = [];
    for (let i = 0; i < 6; i += 1) soldiers.push(makeSoldier(`m${i}`, `M${i}`, 'mefaked_haml', DAYS));
    for (let i = 0; i < 10; i += 1) soldiers.push(makeSoldier(`s${i}`, `S${i}`, 'sambatz', DAYS));

    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null });
    const mefakedCounts = soldiers
      .filter((s) => s.position === 'mefaked_haml')
      .map((s) => res.countsByPhone[s.phone] ?? 0);
    const sambatzCounts = soldiers
      .filter((s) => s.position === 'sambatz')
      .map((s) => res.countsByPhone[s.phone] ?? 0);
    const spread = (arr: number[]) => Math.max(...arr) - Math.min(...arr);
    expect(spread(mefakedCounts)).toBeLessThanOrEqual(1);
    expect(spread(sambatzCounts)).toBeLessThanOrEqual(1);
  });

  it('marks unfilled slots when no candidate fits even after relaxation', () => {
    // Only 1 sambatz total — cannot fill 2 sambatz needed for morning slot.
    const soldiers: SchedulerSoldier[] = [
      makeSoldier('m1', 'M1', 'mefaked_haml', DAYS),
      makeSoldier('s1', 'S1', 'sambatz', DAYS),
    ];
    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null });
    expect(res.unfilled.length).toBeGreaterThan(0);
  });

  it('preserves locked assignments and fills around them', () => {
    const soldiers: SchedulerSoldier[] = [
      makeSoldier('m1', 'Alice', 'mefaked_haml', DAYS),
      makeSoldier('m2', 'Bob', 'mefaked_haml', DAYS),
      makeSoldier('m3', 'Cal', 'mefaked_haml', DAYS),
      makeSoldier('s1', 'Carol', 'sambatz', DAYS),
      makeSoldier('s2', 'Dan', 'sambatz', DAYS),
      makeSoldier('s3', 'Eve', 'sambatz', DAYS),
      makeSoldier('s4', 'Faye', 'sambatz', DAYS),
    ];
    const locked = {
      [DAYS[0]!]: {
        morning: { mefaked_haml: ['Alice'], sambatz: ['Carol'] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
      [DAYS[1]!]: {
        morning: { mefaked_haml: [], sambatz: [] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
      [DAYS[2]!]: {
        morning: { mefaked_haml: [], sambatz: [] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
    };
    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null, locked });

    // Locked entries stay in place.
    expect(res.assignments[DAYS[0]!]!.morning.mefaked_haml).toContain('Alice');
    expect(res.assignments[DAYS[0]!]!.morning.sambatz).toContain('Carol');
    // Demand for morning sambatz (2) is filled by adding one more, never displacing Carol.
    expect(res.assignments[DAYS[0]!]!.morning.sambatz).toHaveLength(2);
    expect(res.assignments[DAYS[0]!]!.morning.mefaked_haml).toHaveLength(1);

    // Alice locked at idx 0. Strict gap (>=3) blocks her until day 1 morning (idx 3).
    expect(res.assignments[DAYS[0]!]!.afternoon.mefaked_haml).not.toContain('Alice');
  });

  it('reduces remaining demand when more than one role slot is locked', () => {
    const soldiers: SchedulerSoldier[] = [
      makeSoldier('m1', 'Alice', 'mefaked_haml', DAYS),
      makeSoldier('m2', 'Bob', 'mefaked_haml', DAYS),
      makeSoldier('s1', 'Carol', 'sambatz', DAYS),
      makeSoldier('s2', 'Dan', 'sambatz', DAYS),
      makeSoldier('s3', 'Eve', 'sambatz', DAYS),
    ];
    const locked = {
      [DAYS[0]!]: {
        morning: { mefaked_haml: [], sambatz: ['Carol', 'Dan'] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
      [DAYS[1]!]: {
        morning: { mefaked_haml: [], sambatz: [] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
      [DAYS[2]!]: {
        morning: { mefaked_haml: [], sambatz: [] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
    };
    const res = generateSchedule({ days: DAYS, soldiers, prevDay: null, locked });
    // Sambatz demand for morning (2) is already met; algo adds zero more.
    expect(res.assignments[DAYS[0]!]!.morning.sambatz.sort()).toEqual(['Carol', 'Dan']);
    expect(res.assignments[DAYS[0]!]!.morning.mefaked_haml).toHaveLength(1);
  });
});
