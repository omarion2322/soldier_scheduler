import { DayCard } from './DayCard';
import type { DayShifts, ShiftSlot, Week } from '../lib/types';

interface Props {
  week: Week;
  shifts: Record<string, DayShifts>;
  unavailableDays: Set<string>;
  readOnly?: boolean;
  onToggleUnavailable: (date: string) => void;
  onCycleShift: (date: string, slot: ShiftSlot) => void;
}

export function WeekView({
  week,
  shifts,
  unavailableDays,
  readOnly,
  onToggleUnavailable,
  onCycleShift,
}: Props) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
      {week.days.map((d) => (
        <DayCard
          key={d}
          date={d}
          shifts={shifts[d] ?? { morning: 'can', afternoon: 'can', night: 'can' }}
          unavailable={unavailableDays.has(d)}
          readOnly={readOnly}
          onToggleUnavailable={() => onToggleUnavailable(d)}
          onCycleShift={(slot) => onCycleShift(d, slot)}
        />
      ))}
    </div>
  );
}
