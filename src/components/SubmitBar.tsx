import { useI18n } from '../lib/i18n';

interface Props {
  onSubmit: () => void;
  submitting: boolean;
  disabled: boolean;
  message?: string | null;
  messageTone?: 'success' | 'error' | 'info';
}

export function SubmitBar({ onSubmit, submitting, disabled, message, messageTone }: Props) {
  const { t } = useI18n();
  const toneClass =
    messageTone === 'success'
      ? 'text-green-700'
      : messageTone === 'error'
        ? 'text-red-700'
        : 'text-slate-600';
  return (
    <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      {message && <p className={`text-sm ${toneClass}`}>{message}</p>}
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled || submitting}
        className="w-full rounded-lg bg-slate-900 px-4 py-3 text-base font-semibold text-white shadow-sm disabled:opacity-40"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </div>
  );
}
