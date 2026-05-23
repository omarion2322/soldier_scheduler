import type { DayShifts, ShiftSlot, ShiftState, Week } from './types';

const SCHEDULE_START_ISO = '2026-05-28';
const SCHEDULE_END_ISO = '2026-07-16';

export const SCHEDULE_TIMEZONE = 'Asia/Jerusalem';

export function toISODate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso: string): Date {
  const parts = iso.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function generateWeeks(): Week[] {
  const weeks: Week[] = [];
  let cursor = SCHEDULE_START_ISO;
  let index = 0;
  while (cursor <= SCHEDULE_END_ISO) {
    let end = addDays(cursor, 6);
    if (end > SCHEDULE_END_ISO) end = SCHEDULE_END_ISO;
    // Absorb a trailing short remainder into this week instead of emitting a
    // stub week with < 7 days.
    if (end < SCHEDULE_END_ISO && addDays(end, 7) > SCHEDULE_END_ISO) {
      end = SCHEDULE_END_ISO;
    }
    const days: string[] = [];
    let d = cursor;
    while (d <= end) {
      days.push(d);
      d = addDays(d, 1);
    }
    weeks.push({ index, start: cursor, end, days });
    if (end >= SCHEDULE_END_ISO) break;
    cursor = addDays(cursor, 7);
    index += 1;
  }
  return weeks;
}

export function getCurrentWeekIndex(now: Date, weeks: Week[]): number {
  if (weeks.length === 0) return 0;
  const today = toISODate(now);
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  if (!first || !last) return 0;
  if (today < first.start) return 0;
  if (today > last.end) return weeks.length - 1;
  for (let i = 0; i < weeks.length; i += 1) {
    const w = weeks[i];
    if (w && today >= w.start && today <= w.end) return i;
  }
  return 0;
}

export function emptyDayShifts(): DayShifts {
  return { morning: 'can', afternoon: 'can', night: 'can' };
}

export function normalizeShiftState(v: unknown): ShiftState {
  return v === 'cant' ? 'cant' : 'can';
}

export function normalizeShifts(
  raw: Record<string, Partial<Record<ShiftSlot, unknown>>> | undefined,
): Record<string, DayShifts> {
  const out: Record<string, DayShifts> = {};
  if (!raw) return out;
  for (const date of Object.keys(raw)) {
    const day = raw[date] ?? {};
    out[date] = {
      morning: normalizeShiftState(day.morning),
      afternoon: normalizeShiftState(day.afternoon),
      night: normalizeShiftState(day.night),
    };
  }
  return out;
}

export function cycleShiftState(state: ShiftState): ShiftState {
  return state === 'cant' ? 'can' : 'cant';
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function formatDayShort(iso: string): string {
  const d = parseISODate(iso);
  return `${WEEKDAY_LABELS[d.getUTCDay()]} ${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function formatWeekRange(week: Week): string {
  const s = parseISODate(week.start);
  const e = parseISODate(week.end);
  const sameMonth = s.getUTCMonth() === e.getUTCMonth();
  const sMonth = MONTH_LABELS[s.getUTCMonth()];
  const eMonth = MONTH_LABELS[e.getUTCMonth()];
  if (sameMonth) {
    return `${sMonth} ${s.getUTCDate()}–${e.getUTCDate()}`;
  }
  return `${sMonth} ${s.getUTCDate()} – ${eMonth} ${e.getUTCDate()}`;
}

/** Returns YYYY-MM-DD for `date` rendered in `timeZone`. */
export function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const SCHEDULE_BOUNDS = {
  startIso: SCHEDULE_START_ISO,
  endIso: SCHEDULE_END_ISO,
} as const;
