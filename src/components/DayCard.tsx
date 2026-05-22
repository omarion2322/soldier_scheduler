import { ShiftButton } from './ShiftButton';
import { SHIFT_SLOTS, type DayShifts, type ShiftSlot } from '../lib/types';
import { formatDayShort } from '../lib/schedule';
import { useI18n } from '../lib/i18n';

interface Props {
  date: string;
  shifts: DayShifts;
  unavailable: boolean;
  readOnly?: boolean;
  onToggleUnavailable: () => void;
  onCycleShift: (slot: ShiftSlot) => void;
}

const SLOT_LABEL_KEY: Record<ShiftSlot, 'morning' | 'afternoon' | 'night'> = {
  morning: 'morning',
  afternoon: 'afternoon',
  night: 'night',
};

export function DayCard({
  date,
  shifts,
  unavailable,
  readOnly,
  onToggleUnavailable,
  onCycleShift,
}: Props) {
  const { t } = useI18n();
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-semibold">{formatDayShort(date)}</h3>
        <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unavailable}
            disabled={readOnly}
            onChange={onToggleUnavailable}
            className="h-5 w-5 rounded border-slate-300 text-red-600 focus:ring-red-500"
          />
          <span className="font-medium">{t('unavailableAllDay')}</span>
        </label>
      </header>
      <div className="flex flex-col gap-2">
        {SHIFT_SLOTS.map((s) => (
          <ShiftButton
            key={s.slot}
            label={t(SLOT_LABEL_KEY[s.slot])}
            time={s.time}
            state={shifts[s.slot]}
            disabled={unavailable || readOnly}
            onCycle={() => onCycleShift(s.slot)}
          />
        ))}
      </div>
    </section>
  );
}
