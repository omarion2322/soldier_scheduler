import { DayCard } from './DayCard';
import type { DayShifts, ShiftSlot, Week } from '../lib/types';

interface Props {
  week: Week;
  shifts: Record<string, DayShifts>;
  unavailableDays: Set<string>;
  reasons: Record<string, Partial<Record<ShiftSlot, string>>>;
  missingReasons: Record<string, Set<ShiftSlot>>;
  readOnly?: boolean;
  onToggleUnavailable: (date: string) => void;
  onCycleShift: (date: string, slot: ShiftSlot) => void;
  onChangeReason: (date: string, slot: ShiftSlot, reason: string) => void;
}

const EMPTY: Set<ShiftSlot> = new Set();

export function WeekView({
  week,
  shifts,
  unavailableDays,
  reasons,
  missingReasons,
  readOnly,
  onToggleUnavailable,
  onCycleShift,
  onChangeReason,
}: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      {week.days.map((d) => (
        <DayCard
          key={d}
          date={d}
          shifts={shifts[d] ?? { morning: 'can', afternoon: 'can', night: 'can' }}
          unavailable={unavailableDays.has(d)}
          reasons={reasons[d] ?? {}}
          missingReasonSlots={missingReasons[d] ?? EMPTY}
          readOnly={readOnly}
          onToggleUnavailable={() => onToggleUnavailable(d)}
          onCycleShift={(slot) => onCycleShift(d, slot)}
          onChangeReason={(slot, reason) => onChangeReason(d, slot, reason)}
        />
      ))}
    </div>
  );
}
