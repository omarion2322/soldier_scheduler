import type { ApiResponse, Submission } from './types';

const API_URL = import.meta.env.VITE_API_URL ?? '';

/**
 * Fetches an existing submission for (phone, weekStart). Returns null if none.
 * Note: we use a simple GET with query params; Apps Script handles CORS.
 */
export async function fetchSubmission(
  phone: string,
  weekStart: string,
): Promise<Submission | null> {
  if (!API_URL) throw new Error('VITE_API_URL is not configured');
  const url = `${API_URL}?phone=${encodeURIComponent(phone)}&week=${encodeURIComponent(weekStart)}`;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const data = (await res.json()) as ApiResponse;
  return data.submission ?? null;
}

/**
 * Fetches the admin-controlled list of locked weeks. Returns [] on failure.
 */
export async function fetchLockedWeeks(): Promise<string[]> {
  if (!API_URL) return [];
  try {
    const res = await fetch(`${API_URL}?mode=locks`, { method: 'GET' });
    if (!res.ok) return [];
    const data = (await res.json()) as { ok: boolean; lockedWeeks?: string[] };
    return Array.isArray(data.lockedWeeks) ? data.lockedWeeks : [];
  } catch {
    return [];
  }
}

/**
 * Submits/updates the submission.
 * We POST as text/plain to avoid a CORS preflight (Apps Script supports this).
 */
export async function postSubmission(submission: Submission): Promise<ApiResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not configured');
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(submission),
  });
  if (!res.ok) {
    return { ok: false, reason: 'server_error' };
  }
  return (await res.json()) as ApiResponse;
}
