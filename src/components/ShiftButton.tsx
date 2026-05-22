import type { ShiftState } from '../lib/types';
import { useI18n } from '../lib/i18n';

const STATE_CLASSES: Record<ShiftState, string> = {
  can: 'bg-green-600 text-white hover:bg-green-700',
  cant: 'bg-red-600 text-white hover:bg-red-700',
};

interface Props {
  label: string;
  time: string;
  state: ShiftState;
  disabled?: boolean;
  onCycle: () => void;
}

export function ShiftButton({ label, time, state, disabled, onCycle }: Props) {
  const { t } = useI18n();
  const effective: ShiftState = disabled ? 'cant' : state === 'cant' ? 'cant' : 'can';
  const stateLabel = effective === 'cant' ? t('stateCant') : t('stateCan');
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={disabled}
      aria-label={`${label} ${time}, ${stateLabel}`}
      className={[
        'flex w-full items-center justify-between rounded-lg px-4 py-3 text-start',
        'min-h-[56px] text-base font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
        'disabled:cursor-not-allowed disabled:opacity-90',
        STATE_CLASSES[effective],
      ].join(' ')}
    >
      <span className="flex flex-col">
        <span>{label}</span>
        <span className="text-xs opacity-80" dir="ltr">
          {time}
        </span>
      </span>
      <span className="text-sm font-semibold">{stateLabel}</span>
    </button>
  );
}
