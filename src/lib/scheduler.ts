import type { DayShifts, Position, ShiftSlot } from './types';

export const SHIFT_ORDER: readonly ShiftSlot[] = ['morning', 'afternoon', 'night'] as const;

/**
 * Placeholder value the operator can put into a slot to mark that the
 * position is intentionally left unfilled. It counts toward the slot's
 * composition demand (so the scheduler doesn't try to fill it and the
 * slot doesn't show up as under-filled), but it doesn't burn any
 * soldier's rest gap or shift count.
 */
export const NA_SENTINEL = '— N/A —';

export function isNA(name: string): boolean {
  return name.trim() === NA_SENTINEL;
}

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

export interface EmergencyNightLeadPolicy {
  enabled: boolean;
  allowedSambatzPhones: string[];
  requiredPartnerByLeadPhone?: Record<string, string>;
}

export interface SchedulerInput {
  days: string[];
  soldiers: SchedulerSoldier[];
  prevDay: PrevDayAssignments | null;
  /**
   * Pre-existing assignments that must be preserved. Any name already in a
   * slot is locked: it counts toward composition demand, reserves its index
   * for the gap constraint, and is never displaced. The scheduler only fills
   * the remaining vacancies.
   */
  locked?: WeekAssignments;
  /**
   * Per-phone count of shifts the soldier has already done in prior weeks
   * (from the "Overall Shifts" ledger). Added to the in-week count when
   * tie-breaking eligible candidates so workload evens out across weeks.
   */
  priorShifts?: Record<string, number>;
  /**
   * If true (default), allow מפקד חמ"ל soldiers to fill סמב"צ vacancies
   * when no סמב"צים are available. The standard rest gap (≥16h, i.e.
   * RELAXED_GAP=2 shifts) is still enforced via pick()'s fallback chain.
   * If false, סמב"צ vacancies are left unfilled instead of borrowing a
   * מפקד.
   */
  allowMefakedAsSambatz?: boolean;
  /**
   * Optional emergency rule for night shifts: when enabled, only these
   * sambatz phones may fill missing night mefaked_haml slots.
   *
   * `requiredPartnerByLeadPhone` can enforce a specific sambatz partner when
   * a given lead phone is placed as night mefaked_haml.
   */
  emergencyNightLead?: EmergencyNightLeadPolicy;
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

function cloneAssignmentsFor(days: string[], src?: WeekAssignments): WeekAssignments {
  const out = emptyAssignments(days);
  if (!src) return out;
  for (const d of days) {
    const day = src[d];
    if (!day) continue;
    for (const slot of SHIFT_ORDER) {
      const block = day[slot];
      if (!block) continue;
      out[d]![slot] = {
        mefaked_haml: [...(block.mefaked_haml ?? [])].filter((n): n is string => typeof n === 'string' && n.trim().length > 0),
        sambatz: [...(block.sambatz ?? [])].filter((n): n is string => typeof n === 'string' && n.trim().length > 0),
      };
    }
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
 * Pre-existing entries in `input.locked` are treated as hard constraints and
 * never displaced.
 * Relaxations (each adds a warning):
 *   a. Gap drops from 2 to 1.
 *   b. Composition swap (sambatz fills a missing mefaked, or vice-versa).
 *   c. Slot left under-filled.
 */
export function generateSchedule(input: SchedulerInput): SchedulerResult {
  const {
    days,
    soldiers,
    prevDay,
    locked,
    priorShifts,
    allowMefakedAsSambatz,
    emergencyNightLead,
  } = input;
  const allowMefakedSwap = allowMefakedAsSambatz !== false;
  const emergencyAllowed = new Set(
    (emergencyNightLead?.allowedSambatzPhones ?? []).map((p) => p.trim()).filter((p) => p.length > 0),
  );
  const emergencyEnabled = Boolean(emergencyNightLead?.enabled) && emergencyAllowed.size > 0;
  const requiredPartnerByLead = emergencyNightLead?.requiredPartnerByLeadPhone ?? {};
  const assignments = cloneAssignmentsFor(days, locked);
  const counts: Record<string, number> = {};
  const takenIndices: Record<string, number[]> = {};
  const warnings: string[] = [];
  const unfilled: UnfilledSlot[] = [];

  for (const s of soldiers) counts[s.phone] = 0;

  const phoneByName = buildPhoneByName(soldiers);

  function addTakenIndex(phone: string, idx: number) {
    const arr = takenIndices[phone] ?? [];
    arr.push(idx);
    takenIndices[phone] = arr;
  }

  function gapOk(phone: string, idx: number, minGap: number): boolean {
    const arr = takenIndices[phone];
    if (!arr) return true;
    for (const j of arr) {
      if (Math.abs(idx - j) < minGap) return false;
    }
    return true;
  }

  // Seed prev-day assignments as negative indices so the rest gap reaches across
  // the week boundary. morning -> -3, afternoon -> -2, night -> -1.
  if (prevDay) {
    const seed: Array<[ShiftSlot, number]> = [
      ['morning', -3],
      ['afternoon', -2],
      ['night', -1],
    ];
    for (const [slot, idx] of seed) {
      const block = prevDay[slot];
      for (const name of [...block.mefaked_haml, ...block.sambatz]) {
        const phone = phoneByName.get(name.trim());
        if (phone) addTakenIndex(phone, idx);
      }
    }
  }

  // Seed locked assignments: counts + taken indices for every pre-placed name.
  // N/A placeholders count toward composition demand but don't burn a soldier's
  // gap or shift count.
  let lockedIndex = 0;
  for (const date of days) {
    for (const slot of SHIFT_ORDER) {
      const block = assignments[date]![slot];
      for (const name of [...block.mefaked_haml, ...block.sambatz]) {
        if (isNA(name)) continue;
        const phone = phoneByName.get(name.trim()) ?? name.trim();
        addTakenIndex(phone, lockedIndex);
        counts[phone] = (counts[phone] ?? 0) + 1;
      }
      lockedIndex += 1;
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
      if (!gapOk(s.phone, currentIndex, minGap)) continue;
      out.push(s);
    }
    out.sort((a, b) => {
      const pa = priorShifts?.[a.phone] ?? 0;
      const pb = priorShifts?.[b.phone] ?? 0;
      const ca = (counts[a.phone] ?? 0) + pa;
      const cb = (counts[b.phone] ?? 0) + pb;
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
      const existing = assignments[date]![slot];

      // Phones already locked here (so we never pick them again for the same slot).
      const taken = new Set<string>();
      for (const name of [...existing.mefaked_haml, ...existing.sambatz]) {
        if (isNA(name)) continue;
        const phone = phoneByName.get(name.trim());
        if (phone) taken.add(phone);
      }

      const lockedMefaked = existing.mefaked_haml.length;
      const lockedSambatz = existing.sambatz.length;
      const needMefaked = Math.max(0, demand.mefaked - lockedMefaked);
      const needSambatz = Math.max(0, demand.sambatz - lockedSambatz);
      const lockedSambatzPhones = new Set(
        existing.sambatz
          .map((name) => phoneByName.get(name.trim()))
          .filter((phone): phone is string => typeof phone === 'string' && phone.length > 0),
      );

      // 1. Mefaked (strict → relaxed).
      const mefakedPick = pick(date, slot, 'mefaked_haml', shiftIndex, needMefaked, taken);
      mefakedPick.phones.forEach((p) => taken.add(p));
      if (mefakedPick.usedRelaxedGap) {
        warnings.push(`${date} ${slot}: relaxed rest gap to 1 shift for מפקד חמ"ל.`);
      }

      // 2. Sambatz.
      let sambatzPick = pick(date, slot, 'sambatz', shiftIndex, needSambatz, taken);
      sambatzPick.phones.forEach((p) => taken.add(p));
      if (sambatzPick.usedRelaxedGap) {
        warnings.push(`${date} ${slot}: relaxed rest gap to 1 shift for סמב"צ.`);
      }

      let mefakedFilled = lockedMefaked + mefakedPick.phones.length;
      let sambatzFilled = lockedSambatz + sambatzPick.phones.length;

      // 3. Composition swap: missing mefaked -> use a sambatz.
      const swappedToMefaked: string[] = [];
      if (mefakedFilled < demand.mefaked) {
        const missingMefaked = demand.mefaked - mefakedFilled;
        const useEmergencyNightRule = slot === 'night' && emergencyEnabled;

        if (useEmergencyNightRule) {
          let candidates = eligible(date, slot, 'sambatz', shiftIndex, STRICT_GAP, taken)
            .filter((s) => emergencyAllowed.has(s.phone));
          let usedRelaxedGap = false;
          if (candidates.length < missingMefaked) {
            const relaxed = eligible(date, slot, 'sambatz', shiftIndex, RELAXED_GAP, taken)
              .filter((s) => emergencyAllowed.has(s.phone));
            if (relaxed.length > candidates.length) {
              candidates = relaxed;
              usedRelaxedGap = true;
            }
          }

          let forcedNightPartner: string | null = null;
          let forcedPartnerUsesRelaxedGap = false;
          for (const c of candidates) {
            if (swappedToMefaked.length >= missingMefaked) break;
            const partnerPhone = requiredPartnerByLead[c.phone];
            if (partnerPhone) {
              if (!lockedSambatzPhones.has(partnerPhone)) {
                // Night requires exactly one sambatz; if it's already locked to
                // someone else, this lead cannot be used.
                if (lockedSambatz >= demand.sambatz) continue;
                const partnerSoldier = soldiersByPhone.get(partnerPhone);
                if (!partnerSoldier || partnerSoldier.position !== 'sambatz') continue;
                const partnerDay = partnerSoldier.availability[date];
                if (!partnerDay || partnerDay[slot] !== 'can') continue;
                if (!gapOk(partnerPhone, shiftIndex, RELAXED_GAP)) continue;
                forcedNightPartner = partnerPhone;
                forcedPartnerUsesRelaxedGap = !gapOk(partnerPhone, shiftIndex, STRICT_GAP);
              }
            }
            swappedToMefaked.push(c.phone);
            taken.add(c.phone);
          }

          if (swappedToMefaked.length > 0) {
            warnings.push(`${date} ${slot}: filled מפקד חמ"ל slot(s) with allowed סמב"צ night lead(s).`);
            mefakedFilled += swappedToMefaked.length;
            if (usedRelaxedGap) {
              warnings.push(`${date} ${slot}: relaxed rest gap to 1 shift for emergency night lead.`);
            }

            // Enforce a required partner in the sambatz slot for this night.
            if (forcedNightPartner && !lockedSambatzPhones.has(forcedNightPartner)) {
              const previous = sambatzPick.phones.slice();
              previous.forEach((p) => taken.delete(p));
              sambatzPick = {
                phones: [forcedNightPartner],
                usedRelaxedGap: sambatzPick.usedRelaxedGap || forcedPartnerUsesRelaxedGap,
              };
              sambatzPick.phones.forEach((p) => taken.add(p));
              sambatzFilled = lockedSambatz + sambatzPick.phones.length;
              warnings.push(`${date} ${slot}: enforced required sambatz partner for emergency night lead.`);
            }
          }
        } else {
          const extra = pick(
            date,
            slot,
            'sambatz',
            shiftIndex,
            missingMefaked,
            taken,
          );
          extra.phones.forEach((p) => taken.add(p));
          if (extra.phones.length > 0) {
            warnings.push(`${date} ${slot}: filled מפקד חמ"ל slot(s) with סמב"צ (composition swap).`);
            swappedToMefaked.push(...extra.phones);
            mefakedFilled += extra.phones.length;
          }
        }
      }

      // 4. Composition swap the other way (gated by allowMefakedAsSambatz).
      const swappedToSambatz: string[] = [];
      if (allowMefakedSwap && sambatzFilled < demand.sambatz) {
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
          warnings.push(`${date} ${slot}: filled סמב"צ slot(s) with מפקד חמ"ל (composition swap).`);
          swappedToSambatz.push(...extra.phones);
          sambatzFilled += extra.phones.length;
        }
      }

      const newMefakedPhones = [...mefakedPick.phones, ...swappedToMefaked];
      const newSambatzPhones = [...sambatzPick.phones, ...swappedToSambatz];

      const newMefakedNames = newMefakedPhones.map((p) => soldiersByPhone.get(p)?.name ?? p);
      const newSambatzNames = newSambatzPhones.map((p) => soldiersByPhone.get(p)?.name ?? p);

      assignments[date]![slot] = {
        mefaked_haml: [...existing.mefaked_haml, ...newMefakedNames],
        sambatz: [...existing.sambatz, ...newSambatzNames],
      };

      for (const p of [...newMefakedPhones, ...newSambatzPhones]) {
        counts[p] = (counts[p] ?? 0) + 1;
        addTakenIndex(p, shiftIndex);
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
