import type { DayShifts, Submission } from './types';

const IDENTITY_KEY = 'soldier_scheduler.identity';

interface IdentityCache {
  name: string;
  phone: string;
}

export function loadIdentity(): IdentityCache | null {
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as IdentityCache;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: IdentityCache): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* ignore quota errors */
  }
}

function draftKey(phone: string, weekStart: string): string {
  return `soldier_scheduler.draft.${phone}.${weekStart}`;
}

export interface Draft {
  shifts: Record<string, DayShifts>;
  unavailableDays: string[];
}

export function loadDraft(phone: string, weekStart: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(phone, weekStart));
    if (!raw) return null;
    return JSON.parse(raw) as Draft;
  } catch {
    return null;
  }
}

export function saveDraft(phone: string, weekStart: string, draft: Draft): void {
  try {
    localStorage.setItem(draftKey(phone, weekStart), JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearDraft(phone: string, weekStart: string): void {
  try {
    localStorage.removeItem(draftKey(phone, weekStart));
  } catch {
    /* ignore */
  }
}

export function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

export type { Submission };
