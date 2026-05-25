import { ShiftButton } from './ShiftButton';
import { SHIFT_SLOTS, type DayShifts, type ShiftSlot } from '../lib/types';
import { formatDayShort } from '../lib/schedule';
import { useI18n } from '../lib/i18n';

interface Props {
  date: string;
  shifts: DayShifts;
  unavailable: boolean;
  reasons: Partial<Record<ShiftSlot, string>>;
  missingReasonSlots: Set<ShiftSlot>;
  readOnly?: boolean;
  onToggleUnavailable: () => void;
  onCycleShift: (slot: ShiftSlot) => void;
  onChangeReason: (slot: ShiftSlot, reason: string) => void;
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
  reasons,
  missingReasonSlots,
  readOnly,
  onToggleUnavailable,
  onCycleShift,
  onChangeReason,
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
        {SHIFT_SLOTS.map((s) => {
          const isCant = shifts[s.slot] === 'cant';
          const needsReason = isCant && !unavailable;
          const missing = missingReasonSlots.has(s.slot);
          return (
            <div key={s.slot} className="flex flex-col gap-1">
              <ShiftButton
                label={t(SLOT_LABEL_KEY[s.slot])}
                time={s.time}
                state={shifts[s.slot]}
                disabled={unavailable || readOnly}
                onCycle={() => onCycleShift(s.slot)}
              />
              {needsReason && (
                <div className="rounded-lg bg-red-50 px-3 py-2">
                  <label className="mb-1 block text-sm font-medium text-red-900">
                    {t('reasonLabel')}
                    <span aria-hidden="true"> *</span>
                  </label>
                  <textarea
                    value={reasons[s.slot] ?? ''}
                    onChange={(e) => onChangeReason(s.slot, e.target.value)}
                    disabled={readOnly}
                    rows={2}
                    placeholder={t('reasonPlaceholder')}
                    aria-invalid={missing || undefined}
                    aria-label={`${t('reasonLabel')} — ${t(SLOT_LABEL_KEY[s.slot])} ${s.time}`}
                    className={[
                      'w-full rounded-md border bg-white px-3 py-2 text-sm',
                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500',
                      missing
                        ? 'border-red-500 ring-1 ring-red-300'
                        : 'border-red-300',
                    ].join(' ')}
                  />
                  {missing && (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      {t('reasonMissing')}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
