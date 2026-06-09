import { useEffect, useMemo, useState } from 'react';
import { WeekNav } from './WeekNav';
import { generateWeeks, getCurrentWeekIndex, formatDayShort } from '../lib/schedule';
import type { ShiftSlot, Submission, WeekAssignmentsDTO, PrevDayAssignmentsDTO } from '../lib/types';
import { fetchAlgoState, fetchWeekSubmissions, saveAlgoResult } from '../lib/api';
import {
  generateSchedule,
  isNA,
  NA_SENTINEL,
  SHIFT_ORDER,
  type PrevDayAssignments,
  type SchedulerSoldier,
  type WeekAssignments,
} from '../lib/scheduler';
import { I18nProvider, useI18n } from '../lib/i18n';

const SLOT_LABEL_HE: Record<ShiftSlot, string> = {
  morning: 'בוקר (06–14)',
  afternoon: 'צהריים (14–22)',
  night: 'לילה (22–06)',
};

const EMERGENCY_NIGHT_LEAD_PHONES = ['503055054', '527033764'] as const;
const REQUIRED_PARTNER_BY_LEAD_PHONE: Record<string, string> = {
  '503055054': '527033764',
};

function emptyAssignmentsFor(days: string[]): WeekAssignments {
  const out: WeekAssignments = {};
  for (const d of days) {
    out[d] = {
      morning: { mefaked_haml: [], sambatz: [] },
      afternoon: { mefaked_haml: [], sambatz: [] },
      night: { mefaked_haml: [], sambatz: [] },
    };
  }
  return out;
}

function emptyPrevDay(): PrevDayAssignments {
  return {
    morning: { mefaked_haml: [], sambatz: [] },
    afternoon: { mefaked_haml: [], sambatz: [] },
    night: { mefaked_haml: [], sambatz: [] },
  };
}

function submissionsToSoldiers(submissions: Submission[]): SchedulerSoldier[] {
  return submissions.map((s) => ({
    phone: s.phone,
    name: s.name,
    position: s.position,
    availability: s.shifts,
  }));
}

function prevDayDateFor(weekStart: string): string {
  const [y, m, d] = weekStart.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function AlgoPageInner() {
  const { t } = useI18n();
  const weeks = useMemo(() => generateWeeks(), []);
  const [index, setIndex] = useState(() => getCurrentWeekIndex(new Date(), weeks));
  const week = weeks[index]!;

  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [prevDay, setPrevDay] = useState<PrevDayAssignments>(() => emptyPrevDay());
  const [assignments, setAssignments] = useState<WeekAssignments>(() => emptyAssignmentsFor(week.days));
  const [priorShifts, setPriorShifts] = useState<Record<string, number>>({});
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [allowMefakedAsSambatz, setAllowMefakedAsSambatz] = useState(true);
  const [allowEmergencyNightLeads, setAllowEmergencyNightLeads] = useState(false);

  // Loads (or reloads) the data for the currently selected week. When
  // `resetWorkInProgress` is true, the in-progress schedule + prev-day
  // entries are cleared first (used on initial week change). Sync keeps
  // the existing schedule visible until the new data arrives, then lets
  // the server's saved assignments replace it if any exist.
  const loadWeek = async (resetWorkInProgress: boolean): Promise<boolean> => {
    setError(null);
    if (resetWorkInProgress) {
      setAssignments(emptyAssignmentsFor(week.days));
      setWarnings([]);
      setPrevDay(emptyPrevDay());
      setInfo(null);
    }
    try {
      const [subs, state] = await Promise.all([
        fetchWeekSubmissions(week.start),
        fetchAlgoState(week.start),
      ]);
      setSubmissions(subs);
      setPriorShifts(state.priorShifts ?? {});
      if (state.prevDay) setPrevDay(toSchedPrev(state.prevDay));
      else if (resetWorkInProgress) setPrevDay(emptyPrevDay());
      if (state.current) {
        setAssignments(toSchedAssignments(state.current, week.days));
        if (resetWorkInProgress) setInfo('נטענה שיבוץ קיים מהגיליון.');
      } else if (resetWorkInProgress) {
        setAssignments(emptyAssignmentsFor(week.days));
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  // Names directory for prev-day dropdowns: every submitter for the week.
  const allNames = useMemo(
    () => submissions.map((s) => s.name).filter((n) => n.trim().length > 0).sort(),
    [submissions],
  );
  const mefakedNames = useMemo(
    () => submissions.filter((s) => s.position === 'mefaked_haml').map((s) => s.name).sort(),
    [submissions],
  );
  const sambatzNames = useMemo(
    () => submissions.filter((s) => s.position === 'sambatz').map((s) => s.name).sort(),
    [submissions],
  );
  const submissionsByName = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) m.set(s.name, s);
    return m;
  }, [submissions]);

  const submissionsByPhone = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) m.set(s.phone, s);
    return m;
  }, [submissions]);

  const emergencyNightLeadNames = useMemo(() => {
    const out: string[] = [];
    for (const phone of EMERGENCY_NIGHT_LEAD_PHONES) {
      const name = submissionsByPhone.get(phone)?.name?.trim();
      if (name) out.push(name);
    }
    return out;
  }, [submissionsByPhone]);

  const requiredLeadName = submissionsByPhone.get('503055054')?.name?.trim() ?? '';
  const requiredPartnerName = submissionsByPhone.get('527033764')?.name?.trim() ?? '';

  const countsByPhone = useMemo(() => {
    const out: Record<string, number> = {};
    const byName: Record<string, string> = {};
    submissions.forEach((s) => {
      byName[s.name] = s.phone;
    });
    for (const date of Object.keys(assignments)) {
      for (const slot of SHIFT_ORDER) {
        const block = assignments[date]![slot];
        for (const n of [...block.mefaked_haml, ...block.sambatz]) {
          if (!n || isNA(n)) continue;
          const phone = byName[n] ?? n;
          out[phone] = (out[phone] ?? 0) + 1;
        }
      }
    }
    return out;
  }, [assignments, submissions]);

  // Load data when the week changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setInfo(null);
    setAssignments(emptyAssignmentsFor(week.days));
    setWarnings([]);
    setPrevDay(emptyPrevDay());
    setPriorShifts({});
    void (async () => {
      try {
        const [subs, state] = await Promise.all([
          fetchWeekSubmissions(week.start),
          fetchAlgoState(week.start),
        ]);
        if (cancelled) return;
        setSubmissions(subs);
        setPriorShifts(state.priorShifts ?? {});
        if (state.prevDay) setPrevDay(toSchedPrev(state.prevDay));
        if (state.current) {
          setAssignments(toSchedAssignments(state.current, week.days));
          setInfo('נטענה שיבוץ קיים מהגיליון.');
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [week.start, week.days]);

  const handleSync = async () => {
    if (syncing || loading) return;
    setSyncing(true);
    const ok = await loadWeek(false);
    setSyncing(false);
    if (ok) {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const ss = String(now.getSeconds()).padStart(2, '0');
      setInfo(`הנתונים סונכרנו מהגיליון (${hh}:${mm}:${ss}).`);
    }
  };

  const handleRun = () => {
    setRunning(true);
    setError(null);
    try {
      const res = generateSchedule({
        days: week.days,
        soldiers: submissionsToSoldiers(submissions),
        prevDay,
        locked: assignments,
        priorShifts,
        allowMefakedAsSambatz,
        emergencyNightLead: {
          enabled: allowEmergencyNightLeads,
          allowedSambatzPhones: [...EMERGENCY_NIGHT_LEAD_PHONES],
          requiredPartnerByLeadPhone: REQUIRED_PARTNER_BY_LEAD_PHONE,
        },
      });
      setAssignments(res.assignments);
      setWarnings(res.warnings);
      if (res.unfilled.length > 0) {
        setInfo(`נוצרה שיבוץ עם ${res.unfilled.length} משבצות שלא הצליחו להתמלא.`);
      } else if (res.warnings.length > 0) {
        setInfo('נוצרה שיבוץ עם פשרות (ראו התראות).');
      } else {
        setInfo('נוצרה שיבוץ ללא פשרות.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleClear = () => {
    setAssignments(emptyAssignmentsFor(week.days));
    setWarnings([]);
    setInfo(null);
  };

  const handleClearDay = (date: string) => {
    setAssignments((prev) => ({
      ...prev,
      [date]: {
        morning: { mefaked_haml: [], sambatz: [] },
        afternoon: { mefaked_haml: [], sambatz: [] },
        night: { mefaked_haml: [], sambatz: [] },
      },
    }));
    setInfo(`השיבוץ של ${date} נוקה.`);
  };

  const handleClearDayPosition = (date: string, position: 'mefaked_haml' | 'sambatz') => {
    setAssignments((prev) => {
      const day = prev[date];
      if (!day) return prev;
      return {
        ...prev,
        [date]: {
          morning: { ...day.morning, [position]: [] },
          afternoon: { ...day.afternoon, [position]: [] },
          night: { ...day.night, [position]: [] },
        },
      };
    });
    const label = position === 'mefaked_haml' ? 'מפקדי חמ"ל' : 'סמב"צים';
    setInfo(`${label} של ${date} נוקו.`);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Hard rule: when 503055054 leads night as mefaked_haml, 527033764 must
      // be in the same night slot as sambatz.
      if (requiredLeadName && requiredPartnerName) {
        for (const d of week.days) {
          const night = assignments[d]?.night;
          if (!night) continue;
          if (night.mefaked_haml.includes(requiredLeadName) && !night.sambatz.includes(requiredPartnerName)) {
            setError(`אי אפשר לשמור: אם ${requiredLeadName} מוביל/ה בלילה כמפקד/ת חמ"ל, ${requiredPartnerName} חייב/ת להיות סמב"צ באותה משמרת.`);
            setSaving(false);
            return;
          }
        }
      }

      const result = await saveAlgoResult({
        weekStart: week.start,
        assignments: toDtoAssignments(assignments, week.days),
      });
      if (result.ok) {
        setInfo('השיבוץ נשמר לגיליון Week N Shifts (טור שיבוץ).');
        // Refresh priorShifts (and any other server state) without
        // clobbering the in-progress hard-constraint edits.
        await loadWeek(false);
      } else {
        const detail = result.error || result.reason;
        setError(detail ? `השמירה נכשלה: ${detail}` : 'השמירה נכשלה.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const updatePrev = (slot: ShiftSlot, role: 'mefaked_haml' | 'sambatz', i: number, name: string) => {
    setPrevDay((prev) => {
      const next = { ...prev, [slot]: { ...prev[slot] } };
      const arr = [...next[slot][role]];
      if (name) {
        while (arr.length < i) arr.push('');
        arr[i] = name;
      } else if (i < arr.length) {
        arr.splice(i, 1);
      }
      const compact = arr.filter((v) => typeof v === 'string' && v.length > 0);
      next[slot] = { ...next[slot], [role]: compact };
      return next;
    });
  };

  const updateAssignment = (
    date: string,
    slot: ShiftSlot,
    role: 'mefaked_haml' | 'sambatz',
    i: number,
    name: string,
  ) => {
    setAssignments((prev) => {
      const day = prev[date] ?? { morning: { mefaked_haml: [], sambatz: [] }, afternoon: { mefaked_haml: [], sambatz: [] }, night: { mefaked_haml: [], sambatz: [] } };
      const block = day[slot] ?? { mefaked_haml: [], sambatz: [] };
      const arr = [...block[role]];
      if (name) {
        while (arr.length < i) arr.push('');
        arr[i] = name;
      } else if (i < arr.length) {
        arr.splice(i, 1);
      }
      const compact = arr.filter((v) => typeof v === 'string' && v.length > 0);
      return {
        ...prev,
        [date]: {
          ...day,
          [slot]: { ...block, [role]: compact },
        },
      };
    });
  };

  const addPrevName = (slot: ShiftSlot, role: 'mefaked_haml' | 'sambatz') => {
    setPrevDay((prev) => {
      const next = { ...prev, [slot]: { ...prev[slot] } };
      next[slot] = { ...next[slot], [role]: [...next[slot][role], ''] };
      return next;
    });
  };

  const prevDate = prevDayDateFor(week.start);

  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col bg-slate-50">
      <header className="px-4 pb-2 pt-4 text-center">
        <h1 className="text-2xl font-bold">{t('appTitle')} — שיבוץ אוטומטי</h1>
        <p className="mt-1 text-sm text-slate-600">
          טוען את האילוצים מהגיליון ומחשב שיבוץ. ניתן לערוך את משמרות יום רביעי הקודם ולחזור על החישוב.
        </p>
      </header>

      <WeekNav weeks={weeks} index={index} onChange={setIndex} />

      {loading && (
        <div className="mx-4 my-2 rounded-lg bg-white p-3 text-sm shadow-sm">טוען נתונים…</div>
      )}
      {error && (
        <div className="mx-4 my-2 rounded-lg bg-red-100 p-3 text-sm text-red-900 shadow-sm">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="mx-4 my-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 shadow-sm">
          {info}
        </div>
      )}

      <section className="mx-4 my-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-bold">
          משמרות יום קודם — {formatDayShort(prevDate)} ({prevDate})
        </h2>
        <p className="mb-3 text-xs text-slate-600">
          הזינו או טענו את שיבוץ יום רביעי הקודם כדי שהאלגוריתם ישמור על מרווח של שתי משמרות לפחות בין משמרות.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SHIFT_ORDER.map((slot) => (
            <div key={slot} className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-2 text-sm font-semibold">{SLOT_LABEL_HE[slot]}</h3>

              <RoleEditor
                label='מפקד חמ"ל'
                names={prevDay[slot].mefaked_haml}
                options={mefakedNames.length > 0 ? mefakedNames : allNames}
                onChange={(i, n) => updatePrev(slot, 'mefaked_haml', i, n)}
                onAdd={() => addPrevName(slot, 'mefaked_haml')}
              />
              <RoleEditor
                label='סמב"צ'
                names={prevDay[slot].sambatz}
                options={sambatzNames.length > 0 ? sambatzNames : allNames}
                onChange={(i, n) => updatePrev(slot, 'sambatz', i, n)}
                onAdd={() => addPrevName(slot, 'sambatz')}
              />
            </div>
          ))}
        </div>
      </section>

      <div className="mx-4 mb-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRun}
          disabled={loading || running || submissions.length === 0}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
        >
          {running ? 'מחשב…' : 'הרצת שיבוץ'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
        >
          {saving ? 'שומר…' : 'שמירה לגיליון'}
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm"
        >
          ניקוי
        </button>
        <button
          type="button"
          onClick={handleSync}
          disabled={loading || syncing}
          title="טען מחדש את האילוצים מהגיליון בלי לאבד את העבודה הנוכחית"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
        >
          {syncing ? 'מסנכרן…' : 'סנכרון מהגיליון'}
        </button>
        <label
          className="flex cursor-pointer select-none items-center gap-2 self-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm"
          title="כשמסומן, אם חסרים סמב״צים ניתן להשתמש במפקדי חמ״ל כסמב״צ (תוך שמירה על מנוחה של 16 שעות לפחות בין משמרות)."
        >
          <input
            type="checkbox"
            checked={allowMefakedAsSambatz}
            onChange={(e) => setAllowMefakedAsSambatz(e.target.checked)}
            className="h-4 w-4 accent-slate-900"
          />
          להשתמש במפקדים כסמב״צים
        </label>
        <label
          className="flex cursor-pointer select-none items-center gap-2 self-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm"
          title="כשמסומן, רק המספרים 503055054 ו-527033764 יכולים למלא חוסר מפקד חמ״ל במשמרת לילה. אם 503055054 מוביל/ה — 527033764 מחויב/ת להיות הסמב״צ בן/בת הזוג באותה משמרת."
        >
          <input
            type="checkbox"
            checked={allowEmergencyNightLeads}
            onChange={(e) => setAllowEmergencyNightLeads(e.target.checked)}
            className="h-4 w-4 accent-slate-900"
          />
          לאפשר סמב״צים ייעודיים כמפקדי לילה
        </label>
        <div className="ml-auto self-center text-xs text-slate-600">
          {submissions.length} חיילים הגישו השבוע
        </div>
      </div>

      {warnings.length > 0 && (
        <section className="mx-4 my-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 shadow-sm">
          <h3 className="mb-1 font-bold">התראות פשרה</h3>
          <ul className="list-disc pr-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-4 my-3 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <h2 className="mb-1 font-bold">שיבוץ שבועי</h2>
        <p className="mb-3 text-xs text-slate-600">
          כל שם שתכניסו לטבלה הופך לאילוץ קשה — האלגוריתם ישבץ את שאר התאים מסביבו ולא יזיז אותו.
        </p>
        {week.days.map((d) => (
          <div key={d} className="mb-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">{formatDayShort(d)}</h3>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleClearDayPosition(d, 'mefaked_haml')}
                  className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-300"
                  title={`נקה רק את משבצות מפקדי חמ"ל של ${d}`}
                >
                  נקה מפקדים
                </button>
                <button
                  type="button"
                  onClick={() => handleClearDayPosition(d, 'sambatz')}
                  className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-300"
                  title={`נקה רק את משבצות הסמב"צים של ${d}`}
                >
                  נקה סמב&quot;צים
                </button>
                <button
                  type="button"
                  onClick={() => handleClearDay(d)}
                  className="rounded-md bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-300"
                  title={`נקה את כל המשמרות של ${d}`}
                >
                  נקה יום
                </button>
              </div>
            </div>
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="w-32 border border-slate-200 p-2 text-right">משמרת</th>
                  <th className="border border-slate-200 p-2 text-right">מפקד חמ&quot;ל</th>
                  <th className="border border-slate-200 p-2 text-right">סמב&quot;צ</th>
                </tr>
              </thead>
              <tbody>
                {SHIFT_ORDER.map((slot) => {
                  const day = assignments[d] ?? {
                    morning: { mefaked_haml: [], sambatz: [] },
                    afternoon: { mefaked_haml: [], sambatz: [] },
                    night: { mefaked_haml: [], sambatz: [] },
                  };
                  const block = day[slot];
                  const demand = slot === 'night' ? { m: 1, s: 1 } : { m: 1, s: 2 };
                  return (
                    <tr key={slot}>
                      <td className="border border-slate-200 bg-slate-50 p-2 font-medium">
                        {SLOT_LABEL_HE[slot]}
                      </td>
                      <td className="border border-slate-200 p-2 align-top">
                        <SlotCellEditor
                          names={block.mefaked_haml}
                          slots={Math.max(demand.m, block.mefaked_haml.length)}
                          options={
                            slot === 'night' && allowEmergencyNightLeads
                              ? Array.from(new Set([...mefakedNames, ...emergencyNightLeadNames]))
                              : mefakedNames
                          }
                          date={d}
                          slot={slot}
                          submissionsByName={submissionsByName}
                          onChange={(i, n) => updateAssignment(d, slot, 'mefaked_haml', i, n)}
                        />
                      </td>
                      <td className="border border-slate-200 p-2 align-top">
                        <SlotCellEditor
                          names={block.sambatz}
                          slots={Math.max(demand.s, block.sambatz.length)}
                          options={sambatzNames}
                          date={d}
                          slot={slot}
                          submissionsByName={submissionsByName}
                          onChange={(i, n) => updateAssignment(d, slot, 'sambatz', i, n)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}

        <h3 className="mt-4 mb-2 font-semibold">איזון משמרות</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-100 text-slate-700">
              <th className="border border-slate-200 p-2 text-right">שם</th>
              <th className="border border-slate-200 p-2 text-right">תפקיד</th>
              <th className="border border-slate-200 p-2 text-right">שבועות קודמים</th>
              <th className="border border-slate-200 p-2 text-right">השבוע</th>
              <th className="border border-slate-200 p-2 text-right">סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {submissions
              .slice()
              .sort((a, b) => {
                const ta = (countsByPhone[b.phone] ?? 0) + (priorShifts[b.phone] ?? 0);
                const tb = (countsByPhone[a.phone] ?? 0) + (priorShifts[a.phone] ?? 0);
                return ta - tb;
              })
              .map((s) => {
                const here = countsByPhone[s.phone] ?? 0;
                const prior = priorShifts[s.phone] ?? 0;
                return (
                  <tr key={s.phone}>
                    <td className="border border-slate-200 p-2">{s.name}</td>
                    <td className="border border-slate-200 p-2">
                      {s.position === 'mefaked_haml' ? 'מפקד חמ"ל' : 'סמב"צ'}
                    </td>
                    <td className="border border-slate-200 p-2 text-slate-500">{prior}</td>
                    <td className="border border-slate-200 p-2">{here}</td>
                    <td className="border border-slate-200 p-2 font-semibold">{prior + here}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function SlotCellEditor(props: {
  names: string[];
  slots: number;
  options: string[];
  date: string;
  slot: ShiftSlot;
  submissionsByName: Map<string, Submission>;
  onChange: (i: number, name: string) => void;
}) {
  const rows: Array<string> = [];
  for (let i = 0; i < props.slots; i += 1) rows.push(props.names[i] ?? '');
  return (
    <div className="flex flex-col gap-1">
      {rows.map((n, i) => {
        const isLocked = (props.names[i] ?? '').length > 0;
        const isNaCell = isNA(n);
        return (
          <select
            key={i}
            value={n}
            onChange={(e) => props.onChange(i, e.target.value)}
            className={`w-full rounded border p-1 text-sm ${
              isNaCell
                ? 'border-slate-400 bg-slate-100 italic text-slate-600'
                : isLocked
                  ? 'border-amber-400 bg-amber-50 font-medium'
                  : 'border-slate-300 bg-white'
            }`}
            title={
              isNaCell
                ? 'משבצת מסומנת N/A — לא תיוצר על ידי האלגוריתם'
                : isLocked
                  ? 'אילוץ קשה — לא יוזז על ידי האלגוריתם'
                  : undefined
            }
          >
            <option value="">— ריק —</option>
            <option value={NA_SENTINEL}>{NA_SENTINEL}</option>
            {props.options.map((opt) => {
              const sub = props.submissionsByName.get(opt);
              const slotState = sub?.shifts?.[props.date]?.[props.slot];
              const cant = slotState === 'cant';
              const unavailable = sub?.unavailableDays?.includes(props.date);
              const marker = cant || unavailable ? '⛔ ' : '';
              return (
                <option key={opt} value={opt}>
                  {marker}
                  {opt}
                </option>
              );
            })}
            {n && !props.options.includes(n) && <option value={n}>{n}</option>}
          </select>
        );
      })}
      <button
        type="button"
        onClick={() => props.onChange(props.slots, '')}
        className="hidden"
        aria-hidden="true"
      />
    </div>
  );
}


function RoleEditor(props: {
  label: string;
  names: string[];
  options: string[];
  onChange: (i: number, name: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-700">{props.label}</span>
        <button
          type="button"
          onClick={props.onAdd}
          className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 ring-1 ring-slate-200"
        >
          + הוספה
        </button>
      </div>
      {props.names.length === 0 && (
        <p className="text-xs text-slate-400">אין משובצים</p>
      )}
      {props.names.map((n, i) => (
        <select
          key={i}
          value={n}
          onChange={(e) => props.onChange(i, e.target.value)}
          className="mb-1 w-full rounded border border-slate-300 bg-white p-1 text-sm"
        >
          <option value="">— בחר —</option>
          {props.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          {n && !props.options.includes(n) && <option value={n}>{n}</option>}
        </select>
      ))}
    </div>
  );
}

function toSchedPrev(dto: PrevDayAssignmentsDTO): PrevDayAssignments {
  return {
    morning: { mefaked_haml: dto.morning.mefaked_haml ?? [], sambatz: dto.morning.sambatz ?? [] },
    afternoon: { mefaked_haml: dto.afternoon.mefaked_haml ?? [], sambatz: dto.afternoon.sambatz ?? [] },
    night: { mefaked_haml: dto.night.mefaked_haml ?? [], sambatz: dto.night.sambatz ?? [] },
  };
}

function toSchedAssignments(dto: WeekAssignmentsDTO, days: string[]): WeekAssignments {
  const out: WeekAssignments = {};
  for (const d of days) {
    const day = dto[d];
    out[d] = {
      morning: { mefaked_haml: day?.morning?.mefaked_haml ?? [], sambatz: day?.morning?.sambatz ?? [] },
      afternoon: { mefaked_haml: day?.afternoon?.mefaked_haml ?? [], sambatz: day?.afternoon?.sambatz ?? [] },
      night: { mefaked_haml: day?.night?.mefaked_haml ?? [], sambatz: day?.night?.sambatz ?? [] },
    };
  }
  return out;
}

function toDtoAssignments(a: WeekAssignments, days: string[]): WeekAssignmentsDTO {
  const out: WeekAssignmentsDTO = {};
  for (const d of days) {
    const day = a[d]!;
    out[d] = {
      morning: day.morning,
      afternoon: day.afternoon,
      night: day.night,
    };
  }
  return out;
}

export default function AlgoPage() {
  return (
    <I18nProvider>
      <AlgoPageInner />
    </I18nProvider>
  );
}
