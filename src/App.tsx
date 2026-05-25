import { useEffect, useMemo, useRef, useState } from 'react';
import { WeekNav } from './components/WeekNav';
import { WeekView } from './components/WeekView';
import { IdentityForm } from './components/IdentityForm';
import { SubmitBar } from './components/SubmitBar';
import {
  cycleShiftState,
  emptyDayShifts,
  generateWeeks,
  getCurrentWeekIndex,
  normalizeReasons,
  normalizeShifts,
} from './lib/schedule';
import type { DayShifts, Position, ShiftSlot, Submission } from './lib/types';
import {
  clearDraft,
  loadDraft,
  loadIdentity,
  normalizePhone,
  saveDraft,
  saveIdentity,
} from './lib/storage';
import { fetchLockedWeeks, fetchSubmission, postSubmission } from './lib/api';
import { I18nProvider, useI18n } from './lib/i18n';

type Toast = { kind: 'success' | 'error' | 'info'; text: string } | null;

const initialShifts = (days: string[]): Record<string, DayShifts> => {
  const out: Record<string, DayShifts> = {};
  for (const d of days) out[d] = emptyDayShifts();
  return out;
};

function AppInner() {
  const { t } = useI18n();
  const weeks = useMemo(() => generateWeeks(), []);
  const [index, setIndex] = useState(() => getCurrentWeekIndex(new Date(), weeks));
  const week = weeks[index]!;

  const cached = useMemo(() => loadIdentity(), []);
  const [name, setName] = useState(cached?.name ?? '');
  const [phone, setPhone] = useState(() => (cached?.phone ?? '').replace(/\D/g, '').slice(0, 10));
  const [position, setPosition] = useState<Position | ''>(cached?.position ?? '');
  const [authenticated, setAuthenticated] = useState(false);

  const [shifts, setShifts] = useState<Record<string, DayShifts>>(() => initialShifts(week.days));
  const [unavailable, setUnavailable] = useState<Set<string>>(() => new Set());
  const [reasons, setReasons] = useState<Record<string, Partial<Record<ShiftSlot, string>>>>(
    () => ({}),
  );
  const [missingReasons, setMissingReasons] = useState<Record<string, Set<ShiftSlot>>>(() => ({}));
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [lockedWeeks, setLockedWeeks] = useState<Set<string>>(() => new Set());
  const loadedKeyRef = useRef<string | null>(null);

  const normalizedPhone = normalizePhone(phone);
  const weekLocked = lockedWeeks.has(week.start);

  // Load admin-controlled lock list once on mount; refresh on auth.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await fetchLockedWeeks();
      if (!cancelled) setLockedWeeks(new Set(list));
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  // When user navigates between weeks after authenticating, refresh from server.
  useEffect(() => {
    if (!authenticated || !normalizedPhone) return;
    const key = `${normalizedPhone}|${week.start}`;
    // handleContinue already loaded this (phone, week); don't clobber its state.
    if (loadedKeyRef.current === key) return;
    loadedKeyRef.current = key;
    const empty = initialShifts(week.days);
    const draft = loadDraft(normalizedPhone, week.start);
    if (draft) {
      setShifts({ ...empty, ...normalizeShifts(draft.shifts) });
      setUnavailable(new Set(draft.unavailableDays));
      setReasons(normalizeReasons(draft.reasons));
      setMissingReasons({});
    } else {
      setShifts(empty);
      setUnavailable(new Set());
      setReasons({});
      setMissingReasons({});
      // Fetch existing submission for this new week in the background.
      void (async () => {
        try {
          const existing = await fetchSubmission(normalizedPhone, week.start);
          if (existing) {
            setShifts({ ...empty, ...normalizeShifts(existing.shifts) });
            setUnavailable(new Set(existing.unavailableDays));
            setReasons(normalizeReasons(existing.reasons));
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
      reasons,
    });
  }, [authenticated, normalizedPhone, week.start, shifts, unavailable, reasons]);

  // Persist identity locally for convenience.
  useEffect(() => {
    if (name || phone || position) saveIdentity({ name, phone, position: position || undefined });
  }, [name, phone, position]);

  const handleCycleShift = (date: string, slot: ShiftSlot) => {
    if (!authenticated || weekLocked || unavailable.has(date)) return;
    setShifts((prev) => {
      const day = prev[date] ?? emptyDayShifts();
      return { ...prev, [date]: { ...day, [slot]: cycleShiftState(day[slot]) } };
    });
    // If toggling back to 'can', drop any reason for this slot and clear its error.
    setReasons((prev) => {
      const day = prev[date] ?? {};
      const wasCant = (shifts[date]?.[slot] ?? 'can') === 'cant';
      if (!wasCant) return prev; // becoming cant; leave reason map alone
      const { [slot]: _drop, ...rest } = day;
      void _drop;
      const next = { ...prev };
      if (Object.keys(rest).length === 0) delete next[date];
      else next[date] = rest;
      return next;
    });
    setMissingReasons((prev) => {
      if (!prev[date]?.has(slot)) return prev;
      const set = new Set(prev[date]);
      set.delete(slot);
      const next = { ...prev };
      if (set.size === 0) delete next[date];
      else next[date] = set;
      return next;
    });
  };

  const handleToggleUnavailable = (date: string) => {
    if (!authenticated || weekLocked) return;
    setUnavailable((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
    // When the day is marked unavailable, per-slot reasons aren't required;
    // clear stale validation errors for the whole day.
    setMissingReasons((prev) => {
      if (!prev[date]) return prev;
      const next = { ...prev };
      delete next[date];
      return next;
    });
  };

  const handleChangeReason = (date: string, slot: ShiftSlot, reason: string) => {
    if (!authenticated || weekLocked) return;
    setReasons((prev) => {
      const day = { ...(prev[date] ?? {}) };
      if (reason.trim() === '') delete day[slot];
      else day[slot] = reason;
      const next = { ...prev };
      if (Object.keys(day).length === 0) delete next[date];
      else next[date] = day;
      return next;
    });
    if (reason.trim() !== '') {
      setMissingReasons((prev) => {
        if (!prev[date]?.has(slot)) return prev;
        const set = new Set(prev[date]);
        set.delete(slot);
        const next = { ...prev };
        if (set.size === 0) delete next[date];
        else next[date] = set;
        return next;
      });
    }
  };

  const handleContinue = async () => {
    if (!name.trim() || normalizedPhone.length !== 10 || !position) return;
    setLoading(true);
    setLoadMessage(null);
    loadedKeyRef.current = `${normalizedPhone}|${week.start}`;
    try {
      const existing = await fetchSubmission(normalizedPhone, week.start);
      const empty = initialShifts(week.days);
      if (existing) {
        setShifts({ ...empty, ...normalizeShifts(existing.shifts) });
        setUnavailable(new Set(existing.unavailableDays));
        setReasons(normalizeReasons(existing.reasons));
        if (existing.position) setPosition(existing.position);
        setLoadMessage(t('loadedPrev'));
      } else {
        setShifts(empty);
        setUnavailable(new Set());
        setReasons({});
        setLoadMessage(t('noPrev'));
      }
      setMissingReasons({});
      setAuthenticated(true);
    } catch (err) {
      setLoadMessage(err instanceof Error ? err.message : t('loadFailed'));
      // Allow them to proceed with an empty form if the server is unreachable.
      setShifts(initialShifts(week.days));
      setUnavailable(new Set());
      setReasons({});
      setMissingReasons({});
      setAuthenticated(true);
    } finally {
      setLoading(false);
    }
  };

  const handleChangeIdentity = () => {
    setAuthenticated(false);
    setLoadMessage(null);
    setToast(null);
    loadedKeyRef.current = null;
  };

  const handleSubmit = async () => {
    if (!authenticated) return;
    if (weekLocked) {
      setToast({ kind: 'error', text: t('weekLockedError') });
      return;
    }
    if (!normalizedPhone || !name.trim() || !position) {
      setToast({ kind: 'error', text: t('missingIdentity') });
      return;
    }
    // Validate: every cant slot on a non-unavailable day must have a reason.
    const missing: Record<string, Set<ShiftSlot>> = {};
    const filteredReasons: Record<string, Partial<Record<ShiftSlot, string>>> = {};
    for (const d of week.days) {
      if (unavailable.has(d)) continue;
      const day = shifts[d];
      if (!day) continue;
      (['morning', 'afternoon', 'night'] as ShiftSlot[]).forEach((slot) => {
        if (day[slot] !== 'cant') return;
        const r = (reasons[d]?.[slot] ?? '').trim();
        if (!r) {
          if (!missing[d]) missing[d] = new Set();
          missing[d].add(slot);
        } else {
          if (!filteredReasons[d]) filteredReasons[d] = {};
          filteredReasons[d]![slot] = r;
        }
      });
    }
    if (Object.keys(missing).length > 0) {
      setMissingReasons(missing);
      setToast({ kind: 'error', text: t('reasonMissing') });
      return;
    }
    setMissingReasons({});
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
        position: position as Position,
        weekStart: week.start,
        unavailableDays: Array.from(unavailable),
        shifts: finalShifts,
        reasons: filteredReasons,
      };
      const res = await postSubmission(submission);
      if (res.ok) {
        setToast({ kind: 'success', text: t('submittedOk') });
        clearDraft(normalizedPhone, week.start);
      } else if (res.reason === 'locked') {
        setLockedWeeks((prev) => new Set(prev).add(week.start));
        setToast({ kind: 'error', text: t('weekLockedError') });
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
      <header className="px-4 pb-2 pt-4 text-center">
        <h1 className="text-2xl font-bold">{t('appTitle')}</h1>
      </header>

      <IdentityForm
        name={name}
        phone={phone}
        position={position}
        locked={authenticated}
        onNameChange={setName}
        onPhoneChange={setPhone}
        onPositionChange={setPosition}
        onContinue={handleContinue}
        onChange={handleChangeIdentity}
        loading={loading}
        loadMessage={loadMessage}
      />

      {authenticated && (
        <>
          <section
            aria-label={t('instructionsTitle')}
            className="mx-4 mt-4 rounded-xl border-2 border-blue-300 bg-blue-50 p-4 shadow-sm"
          >
            <h2 className="mb-2 text-center text-lg font-bold text-blue-900">
              {t('instructionsTitle')}
            </h2>
            <p className="text-center text-base leading-relaxed text-slate-800">
              {t('intro')}
            </p>
          </section>

          <WeekNav weeks={weeks} index={index} onChange={setIndex} />

          {weekLocked && (
            <div className="mx-4 mb-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
              {t('weekLocked')}
            </div>
          )}

          <WeekView
            week={week}
            shifts={shifts}
            unavailableDays={unavailable}
            reasons={reasons}
            missingReasons={missingReasons}
            readOnly={weekLocked}
            onCycleShift={handleCycleShift}
            onToggleUnavailable={handleToggleUnavailable}
            onChangeReason={handleChangeReason}
          />

          <SubmitBar
            onSubmit={handleSubmit}
            submitting={submitting}
            disabled={weekLocked || !name.trim() || !normalizedPhone || !position}
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
