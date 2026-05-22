import { useI18n } from '../lib/i18n';
import { POSITIONS, type Position } from '../lib/types';

interface Props {
  name: string;
  phone: string;
  position: Position | '';
  locked: boolean;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onPositionChange: (v: Position | '') => void;
  onContinue: () => void;
  onChange: () => void;
  loading: boolean;
  loadMessage?: string | null;
}

export function IdentityForm({
  name,
  phone,
  position,
  locked,
  onNameChange,
  onPhoneChange,
  onPositionChange,
  onContinue,
  onChange,
  loading,
  loadMessage,
}: Props) {
  const { t } = useI18n();
  const digits = phone.replace(/\D/g, '');
  const canContinue =
    digits.length === 10 && name.trim().length > 0 && position !== '' && !loading;

  const positionLabel = (p: Position) =>
    p === 'sambatz' ? t('positionSambatz') : t('positionMefakedHaml');

  return (
    <section className="mx-4 mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold">{t('yourDetails')}</h2>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('name')}
          <input
            type="text"
            value={name}
            disabled={locked}
            onChange={(e) => onNameChange(e.target.value)}
            autoComplete="name"
            className="rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
            placeholder={t('namePlaceholder')}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('phone')}
          <input
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={10}
            value={phone}
            disabled={locked}
            onChange={(e) => onPhoneChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
            autoComplete="tel"
            dir="ltr"
            className="rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
            placeholder={t('phonePlaceholder')}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('position')}
          <select
            value={position}
            disabled={locked}
            onChange={(e) => onPositionChange(e.target.value as Position | '')}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
          >
            <option value="" disabled>
              {t('positionPlaceholder')}
            </option>
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {positionLabel(p)}
              </option>
            ))}
          </select>
        </label>
        {!locked ? (
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="self-start rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
          >
            {loading ? t('loading') : t('continue')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onChange}
            className="self-start rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm"
          >
            {t('change')}
          </button>
        )}
        {loadMessage && <p className="text-sm text-slate-600">{loadMessage}</p>}
      </div>
    </section>
  );
}
