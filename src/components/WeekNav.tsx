import type { Week } from '../lib/types';
import { formatWeekRange } from '../lib/schedule';
import { useI18n } from '../lib/i18n';

interface Props {
  weeks: Week[];
  index: number;
  onChange: (index: number) => void;
}

export function WeekNav({ weeks, index, onChange }: Props) {
  const { t } = useI18n();
  const week = weeks[index];
  if (!week) return null;
  const canPrev = index > 0;
  const canNext = index < weeks.length - 1;
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-slate-50/95 px-4 py-3 backdrop-blur">
      <button
        type="button"
        onClick={() => canPrev && onChange(index - 1)}
        disabled={!canPrev}
        aria-label={t('prevAria')}
        className="rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-slate-200 disabled:opacity-40"
      >
        {t('prev')}
      </button>
      <div className="flex flex-col items-center">
        <span className="text-xs uppercase tracking-wide text-slate-500">
          {t('weekOf', { n: index + 1, total: weeks.length })}
        </span>
        <span className="text-base font-semibold">{formatWeekRange(week)}</span>
      </div>
      <button
        type="button"
        onClick={() => canNext && onChange(index + 1)}
        disabled={!canNext}
        aria-label={t('nextAria')}
        className="rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-slate-200 disabled:opacity-40"
      >
        {t('next')}
      </button>
    </div>
  );
}
