import { useEffect, useMemo, useState } from 'react';
import { WeekNav } from './components/WeekNav';
import { WeekView } from './components/WeekView';
import { IdentityForm } from './components/IdentityForm';
import { SubmitBar } from './components/SubmitBar';
import {
  cycleShiftState,
  emptyDayShifts,
  generateWeeks,
  getCurrentWeekIndex,
  isPastDeadline,
  normalizeShifts,
} from './lib/schedule';
import type { DayShifts, ShiftSlot, Submission } from './lib/types';
import {
  clearDraft,
  loadDraft,
  loadIdentity,
  normalizePhone,
  saveDraft,
  saveIdentity,
} from './lib/storage';
import { fetchSubmission, postSubmission } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';

type Toast = { kind: 'success' | 'error' | 'info'; text: string } | null;

const initialShifts = (days: string[]): Record<string, DayShifts> => {
  const out: Record<string, DayShifts> = {};
  for (const d of days) out[d] = emptyDayShifts();
  return out;
};

function AppInner() {
  const { t, lang, setLang } = useI18n();
  const weeks = useMemo(() => generateWeeks(), []);
  const [index, setIndex] = useState(() => getCurrentWeekIndex(new Date(), weeks));
  const week = weeks[index]!;

  const cached = useMemo(() => loadIdentity(), []);
  const [name, setName] = useState(cached?.name ?? '');
  const [phone, setPhone] = useState(() => (cached?.phone ?? '').replace(/\D/g, '').slice(0, 10));
  const [authenticated, setAuthenticated] = useState(false);

  const [shifts, setShifts] = useState<Record<string, DayShifts>>(() => initialShifts(week.days));
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);

  const normalizedPhone = normalizePhone(phone);
  const pastDeadline = isPastDeadline(week.start, new Date());

  // When user navigates between weeks after authenticating, refresh from server.
  useEffect(() => {
    if (!authenticated || !normalizedPhone) return;
    const empty = initialShifts(week.days);
    const draft = loadDraft(normalizedPhone, week.start);
    if (draft) {
      setShifts({ ...empty, ...normalizeShifts(draft.shifts) });
      setUnavailable(new Set(draft.unavailableDays));
    } else {
      setShifts(empty);
      setUnavailable(new Set());
      // Fetch existing submission for this new week in the background.
      void (async () => {
        try {
          const existing = await fetchSubmission(normalizedPhone, week.start);
          if (existing) {
            setShifts({ ...empty, ...normalizeShifts(existing.shifts) });
            setUnavailable(new Set(existing.unavailableDays));
          }
        } catch {
          /* keep empty on failure */
        }
      })();
    }
  }, [authenticated, normalizedPhone, week.start, week.days]);

  // Autosave drafts once authenticated.
  useEffect(() => {
    if (!authenticated || !normalizedPhone) return;
    saveDraft(normalizedPhone, week.start, {
      shifts,
      unavailableDays: Array.from(unavailable),
    });
  }, [authenticated, normalizedPhone, week.start, shifts, unavailable]);

  // Persist identity locally for convenience.
  useEffect(() => {
    if (name || phone) saveIdentity({ name, phone });
  }, [name, phone]);

  const handleCycleShift = (date: string, slot: ShiftSlot) => {
    if (!authenticated || unavailable.has(date)) return;
    setShifts((prev) => {
      const day = prev[date] ?? emptyDayShifts();
      return { ...prev, [date]: { ...day, [slot]: cycleShiftState(day[slot]) } };
    });
  };

  const handleToggleUnavailable = (date: string) => {
    if (!authenticated) return;
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  };

  const handleContinue = async () => {
    if (!name.trim() || normalizedPhone.length !== 10) return;
    setLoading(true);
    setLoadMessage(null);
    try {
      const existing = await fetchSubmission(normalizedPhone, week.start);
      const empty = initialShifts(week.days);
      if (existing) {
        setShifts({ ...empty, ...normalizeShifts(existing.shifts) });
        setUnavailable(new Set(existing.unavailableDays));
        setLoadMessage(t('loadedPrev'));
      } else {
        setShifts(empty);
        setUnavailable(new Set());
        setLoadMessage(t('noPrev'));
      }
      setAuthenticated(true);
    } catch (err) {
      setLoadMessage(err instanceof Error ? err.message : t('loadFailed'));
      // Allow them to proceed with an empty form if the server is unreachable.
      setShifts(initialShifts(week.days));
      setUnavailable(new Set());
      setAuthenticated(true);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeIdentity = () => {
    setAuthenticated(false);
    setLoadMessage(null);
    setToast(null);
  };

  const handleSubmit = async () => {
    if (!authenticated) return;
    if (!normalizedPhone || !name.trim()) {
      setToast({ kind: 'error', text: t('missingIdentity') });
      return;
    }
    if (pastDeadline) {
      setToast({ kind: 'error', text: t('deadlineError') });
      return;
    }
    setSubmitting(true);
    setToast(null);
    try {
      const finalShifts: Record<string, DayShifts> = { ...shifts };
      for (const d of unavailable) {
        finalShifts[d] = { morning: 'cant', afternoon: 'cant', night: 'cant' };
      }
      const submission: Submission = {
        phone: normalizedPhone,
        name: name.trim(),
        weekStart: week.start,
        unavailableDays: Array.from(unavailable),
        shifts: finalShifts,
      };
      const res = await postSubmission(submission);
      if (res.ok) {
        setToast({ kind: 'success', text: t('submittedOk') });
        clearDraft(normalizedPhone, week.start);
      } else if (res.reason === 'deadline_passed') {
        setToast({ kind: 'error', text: t('deadlineError') });
      } else {
        setToast({ kind: 'error', text: t('submitFailed') });
      }
    } catch (err) {
      setToast({
        kind: 'error',
        text: err instanceof Error ? err.message : t('submitFailed'),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col bg-slate-50">
      <header className="flex items-start justify-between gap-3 px-4 pb-2 pt-4">
        <div>
          <h1 className="text-2xl font-bold">{t('appTitle')}</h1>
          <p className="text-sm text-slate-600">{t('intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setLang(lang === 'en' ? 'he' : 'en')}
          className="shrink-0 rounded-lg bg-white px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-slate-200"
          aria-label={t('toggleLang')}
        >
          {t('toggleLang')}
        </button>
      </header>

      <IdentityForm
        name={name}
        phone={phone}
        locked={authenticated}
        onNameChange={setName}
        onPhoneChange={setPhone}
        onContinue={handleContinue}
        onChange={handleChangeIdentity}
        loading={loading}
        loadMessage={loadMessage}
      />

      {authenticated && (
        <>
          <WeekNav weeks={weeks} index={index} onChange={setIndex} />

          {pastDeadline && (
            <div className="mx-4 mb-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {t('deadlinePassed')}
            </div>
          )}

          <WeekView
            week={week}
            shifts={shifts}
            unavailableDays={unavailable}
            readOnly={pastDeadline}
            onCycleShift={handleCycleShift}
            onToggleUnavailable={handleToggleUnavailable}
          />

          <SubmitBar
            onSubmit={handleSubmit}
            submitting={submitting}
            disabled={pastDeadline || !name.trim() || !normalizedPhone}
            message={toast?.text}
            messageTone={toast?.kind}
          />
        </>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppInner />
    </I18nProvider>
  );
}
