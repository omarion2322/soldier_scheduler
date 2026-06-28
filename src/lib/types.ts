export type ShiftSlot = 'morning' | 'afternoon' | 'night';
export type ShiftState = 'can' | 'cant';
// 'both' is an admin-only position (set manually on the sheet) for soldiers
// who can serve as either a mefaked_haml or a sambatz. It is intentionally
// absent from POSITIONS so it is never offered in the public submission form.
export type Position = 'sambatz' | 'mefaked_haml' | 'both';

export const POSITIONS: readonly Position[] = ['sambatz', 'mefaked_haml'] as const;

export interface ShiftSlotInfo {
  slot: ShiftSlot;
  label: string;
  time: string;
}

export const SHIFT_SLOTS: readonly ShiftSlotInfo[] = [
  { slot: 'morning', label: 'Morning', time: '06:00–14:00' },
  { slot: 'afternoon', label: 'Afternoon', time: '14:00–22:00' },
  { slot: 'night', label: 'Night', time: '22:00–06:00' },
] as const;

export type DayShifts = Record<ShiftSlot, ShiftState>;

export type ReasonsByDate = Record<string, Partial<Record<ShiftSlot, string>>>;

export interface Submission {
  phone: string;
  name: string;
  position: Position;
  weekStart: string;
  unavailableDays: string[];
  shifts: Record<string, DayShifts>;
  reasons?: ReasonsByDate;
  submittedAt?: string;
}

export interface Week {
  index: number;
  start: string;
  end: string;
  days: string[];
}

export interface ApiResponse {
  ok: boolean;
  reason?: 'invalid' | 'server_error' | 'locked';
  submission?: Submission;
}

export interface SlotAssignmentDTO {
  mefaked_haml: string[];
  sambatz: string[];
}

export interface PrevDayAssignmentsDTO {
  morning: SlotAssignmentDTO;
  afternoon: SlotAssignmentDTO;
  night: SlotAssignmentDTO;
}

export type WeekAssignmentsDTO = Record<string, Record<ShiftSlot, SlotAssignmentDTO>>;

export interface AlgoLoadResponse {
  ok: boolean;
  weekStart: string;
  prevDay: PrevDayAssignmentsDTO | null;
  current: WeekAssignmentsDTO | null;
  priorShifts?: Record<string, number>;
}

export interface AlgoSavePayload {
  mode: 'algo';
  weekStart: string;
  assignments: WeekAssignmentsDTO;
}
