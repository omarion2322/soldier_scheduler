import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'he';

const LANG_KEY = 'soldier_scheduler.lang';

type Dict = Record<string, string>;

const EN: Dict = {
  appTitle: 'Soldier Scheduler',
  intro:
    'Mark each shift as Can or Can’t. Tap "At Home" to mark a full day as Can’t.',
  yourDetails: 'Your details',
  name: 'Name',
  namePlaceholder: 'Full name',
  phone: 'Phone',
  phonePlaceholder: '0501234567',
  position: 'Position',
  positionPlaceholder: 'Select position',
  positionSambatz: 'סמב״צ',
  positionMefakedHaml: 'מפקד חמל',
  continue: 'Continue',
  loading: 'Loading…',
  change: 'Change',
  weekOf: 'Week {n} of {total}',
  prev: '← Prev',
  next: 'Next →',
  prevAria: 'Previous week',
  nextAria: 'Next week',
  unavailableAllDay: 'At Home',
  morning: 'Morning',
  afternoon: 'Afternoon',
  night: 'Night',
  statePrefer: 'Prefer',
  stateCant: "Can't",
  stateCan: 'Can',
  submit: 'Submit',
  submitting: 'Submitting…',
  signInFirst: 'Enter your name and phone, then tap Continue to start.',
  loadedPrev: 'Loaded your previous answers. Edit and submit again to update.',
  noPrev: 'No previous submission found for this week. Starting fresh.',
  loadFailed: 'Failed to load your previous answers.',
  submittedOk: 'Submitted. Thanks!',
  submitFailed: 'Submission failed. Try again.',
  weekLocked: 'This week is locked by the admin. You can view but not edit.',
  weekLockedError: 'This week is locked. Submission rejected.',
  missingIdentity: 'Please enter your name and phone.',
  toggleLang: 'עברית',
  instructionsTitle: 'Instructions',
  reasonLabel: 'Reason',
  reasonPlaceholder: 'Why can’t you take this shift?',
  reasonMissing: 'Please provide a reason for every shift marked Can’t.',
};

const HE: Dict = {
  appTitle: 'מערכת שיבוץ חיילים',
  intro:
    'סמנו כל משמרת כ״יכול״ או ״לא יכול״ אם יש אילוץ שמונע. סמנו ״בבית״ כדי לסמן יום שלם כלא יכול. מי שישן בבסיס, לסמן משמרת בוקר ביום שהוא חוזר ומשמרת לילה יום לפני שהוא יוצא ב״לא יכול״.',
  yourDetails: 'הפרטים שלך',
  name: 'שם',
  namePlaceholder: 'שם מלא',
  phone: 'טלפון',
  phonePlaceholder: '0501234567',
  position: 'תפקיד',
  positionPlaceholder: 'בחר תפקיד',
  positionSambatz: 'סמב״צ',
  positionMefakedHaml: 'מפקד חמל',
  continue: 'המשך',
  loading: 'טוען…',
  change: 'שינוי',
  weekOf: 'שבוע {n} מתוך {total}',
  prev: 'הקודם →',
  next: '← הבא',
  prevAria: 'שבוע קודם',
  nextAria: 'שבוע הבא',
  unavailableAllDay: 'בבית',
  morning: 'בוקר',
  afternoon: 'צהריים',
  night: 'לילה',
  statePrefer: 'מעדיף',
  stateCant: 'לא יכול',
  stateCan: 'יכול',
  submit: 'שליחה',
  submitting: 'שולח…',
  signInFirst: 'הזינו שם וטלפון, ולחצו "המשך" כדי להתחיל.',
  loadedPrev: 'נטענו האילוצים הקודמים שלך. ערוך ושלח שוב כדי לעדכן.',
  noPrev: 'לא נמצא הגשת אילוצים קודמת, מתחילים מחדש.',
  loadFailed: 'טעינת התשובות הקודמות נכשלה.',
  submittedOk: 'נשלח. תודה!',
  submitFailed: 'השליחה נכשלה. נסה שוב.',
  weekLocked: 'השבוע הזה ננעל על ידי המנהל. אפשר לצפות אך לא לערוך.',
  weekLockedError: 'השבוע הזה נעול. ההגשה נדחתה.',
  missingIdentity: 'נא להזין שם וטלפון.',
  toggleLang: 'English',
  instructionsTitle: 'הוראות',
  reasonLabel: 'סיבה',
  reasonPlaceholder: 'מדוע אינך זמין למשמרת הזו?',
  reasonMissing: 'יש למלא סיבה לכל משמרת שסומנה ״לא יכול״.',
};

const DICTS: Record<Lang, Dict> = { en: EN, he: HE };

function loadLang(): Lang {
  return 'he';
}

function saveLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof typeof EN, vars?: Record<string, string | number>) => string;
}

const Ctx = createContext<I18nCtx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => loadLang());

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
  }, [lang]);

  const value = useMemo<I18nCtx>(
    () => ({
      lang,
      setLang: (l) => {
        saveLang(l);
        setLangState(l);
      },
      t: (key, vars) => {
        let s = DICTS[lang][key] ?? EN[key] ?? String(key);
        if (vars) {
          for (const k of Object.keys(vars)) {
            s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
          }
        }
        return s;
      },
    }),
    [lang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useI18n must be used inside I18nProvider');
  return ctx;
}
