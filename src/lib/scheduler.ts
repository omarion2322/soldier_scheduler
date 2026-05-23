import type { DayShifts, Position, ShiftSlot } from './types';

export const SHIFT_ORDER: readonly ShiftSlot[] = ['morning', 'afternoon', 'night'] as const;

export interface SchedulerSoldier {
  phone: string;
  name: string;
  position: Position;
  availability: Record<string, DayShifts>;
}

export interface SlotAssignment {
  mefaked_haml: string[];
  sambatz: string[];
}

export type WeekAssignments = Record<string, Record<ShiftSlot, SlotAssignment>>;

export interface PrevDayAssignments {
  morning: SlotAssignment;
  afternoon: SlotAssignment;
  night: SlotAssignment;
}

export interface SchedulerInput {
  days: string[];
  soldiers: SchedulerSoldier[];
  prevDay: PrevDayAssignments | null;
}

export interface UnfilledSlot {
  date: string;
  slot: ShiftSlot;
  position: Position;
  needed: number;
  filled: number;
}

export interface SchedulerResult {
  assignments: WeekAssignments;
  countsByPhone: Record<string, number>;
  warnings: string[];
  unfilled: UnfilledSlot[];
}

const STRICT_GAP = 3;
const RELAXED_GAP = 2;

function emptySlot(): SlotAssignment {
  return { mefaked_haml: [], sambatz: [] };
}

function emptyAssignments(days: string[]): WeekAssignments {
  const out: WeekAssignments = {};
  for (const d of days) {
    out[d] = {
      morning: emptySlot(),
      afternoon: emptySlot(),
      night: emptySlot(),
    };
  }
  return out;
}

function shiftDemand(slot: ShiftSlot): { mefaked: number; sambatz: number } {
  return slot === 'night' ? { mefaked: 1, sambatz: 1 } : { mefaked: 1, sambatz: 2 };
}

function buildPhoneByName(soldiers: SchedulerSoldier[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of soldiers) {
    const key = s.name.trim();
    if (key && !map.has(key)) map.set(key, s.phone);
  }
  return map;
}

/**
 * Generates a weekly schedule that satisfies the constraints in priority order:
 *   1. Per-slot composition: 1 mefaked_haml + 2 sambatz (1+1 at night).
 *   2. At least 2 shifts of rest between consecutive assignments per person.
 *   3. Balance total shift count across soldiers.
 * Relaxations (each adds a warning):
 *   a. Gap drops from 2 to 1.
 *   b. Composition swap (sambatz fills a missing mefaked, or vice-versa).
 *   c. Slot left under-filled.
 */
export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const { days, soldiers, prevDay } = input;
  const assignments = emptyAssignments(days);
  const counts: Record<string, number> = {};
  const lastShiftIndex: Record<string, number> = {};
  const warnings: string[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const s of soldiers) counts[s.phone] = 0;

  // Encode prev day as negative indices so the gap constraint extends across the boundary.
  // morning -> -3, afternoon -> -2, night -> -1 (so night to next-day morning has gap 1).
  if (prevDay) {
    const phoneByName = buildPhoneByName(soldiers);
    const seed: Array<[ShiftSlot, number]> = [
      ['morning', -3],
      ['afternoon', -2],
      ['night', -1],
    ];
    for (const [slot, idx] of seed) {
      const block = prevDay[slot];
      const names = [...block.mefaked_haml, ...block.sambatz];
      for (const name of names) {
        const phone = phoneByName.get(name.trim());
        if (!phone) continue;
        const prev = lastShiftIndex[phone];
        if (prev === undefined || idx > prev) lastShiftIndex[phone] = idx;
      }
    }
  }

  const soldiersByPhone = new Map(soldiers.map((s) => [s.phone, s]));

  function eligible(
    date: string,
    slot: ShiftSlot,
    position: Position,
    currentIndex: number,
    minGap: number,
    excludedPhones: Set<string>,
  ): SchedulerSoldier[] {
    const out: SchedulerSoldier[] = [];
    for (const s of soldiers) {
      if (s.position !== position) continue;
      if (excludedPhones.has(s.phone)) continue;
      const day = s.availability[date];
      if (!day || day[slot] !== 'can') continue;
      const last = lastShiftIndex[s.phone];
      if (last !== undefined && currentIndex - last < minGap) continue;
      out.push(s);
    }
    // Stable ordering: fewer assignments first, then by phone for determinism.
    out.sort((a, b) => {
      const ca = counts[a.phone] ?? 0;
      const cb = counts[b.phone] ?? 0;
      if (ca !== cb) return ca - cb;
      return a.phone < b.phone ? -1 : a.phone > b.phone ? 1 : 0;
    });
    return out;
  }

  function pick(
    date: string,
    slot: ShiftSlot,
    position: Position,
    currentIndex: number,
    needed: number,
    excluded: Set<string>,
  ): { phones: string[]; usedRelaxedGap: boolean } {
    if (needed <= 0) return { phones: [], usedRelaxedGap: false };
    let candidates = eligible(date, slot, position, currentIndex, STRICT_GAP, excluded);
    let usedRelaxedGap = false;
    if (candidates.length < needed) {
      const relaxed = eligible(date, slot, position, currentIndex, RELAXED_GAP, excluded);
      if (relaxed.length > candidates.length) {
        candidates = relaxed;
        usedRelaxedGap = true;
      }
    }
    return { phones: candidates.slice(0, needed).map((s) => s.phone), usedRelaxedGap };
  }

  let shiftIndex = 0;
  for (const date of days) {
    for (const slot of SHIFT_ORDER) {
      const demand = shiftDemand(slot);
      const taken = new Set<string>();

      // 1. Try mefaked first with strict-then-relaxed gap.
      const mefakedPick = pick(date, slot, 'mefaked_haml', shiftIndex, demand.mefaked, taken);
      mefakedPick.phones.forEach((p) => taken.add(p));
      let mefakedFilled = mefakedPick.phones.length;
      if (mefakedPick.usedRelaxedGap) {
        warnings.push(
          `${date} ${slot}: relaxed rest gap to 1 shift for מפקד חמ"ל.`,
        );
      }

      // 2. Sambatz next.
      const sambatzPick = pick(date, slot, 'sambatz', shiftIndex, demand.sambatz, taken);
      sambatzPick.phones.forEach((p) => taken.add(p));
      let sambatzFilled = sambatzPick.phones.length;
      if (sambatzPick.usedRelaxedGap) {
        warnings.push(
          `${date} ${slot}: relaxed rest gap to 1 shift for סמב"צ.`,
        );
      }

      // 3. Composition swap as last resort: missing mefaked -> use a sambatz.
      if (mefakedFilled < demand.mefaked) {
        const extra = pick(
          date,
          slot,
          'sambatz',
          shiftIndex,
          demand.mefaked - mefakedFilled,
          taken,
        );
        extra.phones.forEach((p) => taken.add(p));
        if (extra.phones.length > 0) {
          warnings.push(
            `${date} ${slot}: filled מפקד חמ"ל slot(s) with סמב"צ (composition swap).`,
          );
          mefakedPick.phones.push(...extra.phones);
          mefakedFilled += extra.phones.length;
        }
      }

      // 4. Composition swap the other way: missing sambatz -> use a mefaked.
      if (sambatzFilled < demand.sambatz) {
        const extra = pick(
          date,
          slot,
          'mefaked_haml',
          shiftIndex,
          demand.sambatz - sambatzFilled,
          taken,
        );
        extra.phones.forEach((p) => taken.add(p));
        if (extra.phones.length > 0) {
          warnings.push(
            `${date} ${slot}: filled סמב"צ slot(s) with מפקד חמ"ל (composition swap).`,
          );
          sambatzPick.phones.push(...extra.phones);
          sambatzFilled += extra.phones.length;
        }
      }

      // Apply assignments.
      const mefakedNames = mefakedPick.phones.map((p) => soldiersByPhone.get(p)?.name ?? p);
      const sambatzNames = sambatzPick.phones.map((p) => soldiersByPhone.get(p)?.name ?? p);
      assignments[date]![slot] = {
        mefaked_haml: mefakedNames,
        sambatz: sambatzNames,
      };
      for (const p of [...mefakedPick.phones, ...sambatzPick.phones]) {
        counts[p] = (counts[p] ?? 0) + 1;
        lastShiftIndex[p] = shiftIndex;
      }

      if (mefakedFilled < demand.mefaked) {
        unfilled.push({
          date,
          slot,
          position: 'mefaked_haml',
          needed: demand.mefaked,
          filled: mefakedFilled,
        });
        warnings.push(
          `${date} ${slot}: מפקד חמ"ל under-filled (${mefakedFilled}/${demand.mefaked}).`,
        );
      }
      if (sambatzFilled < demand.sambatz) {
        unfilled.push({
          date,
          slot,
          position: 'sambatz',
          needed: demand.sambatz,
          filled: sambatzFilled,
        });
        warnings.push(
          `${date} ${slot}: סמב"צ under-filled (${sambatzFilled}/${demand.sambatz}).`,
        );
      }

      shiftIndex += 1;
    }
  }

  return { assignments, countsByPhone: counts, warnings, unfilled };
}
