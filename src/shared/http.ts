import { getAccessToken } from '../auth/authSession';
import { getApiBase } from './apiBackendUrl';

/** Authorization header when a JWT session exists. */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const apiBase = getApiBase();
  const url = path.startsWith('http')
    ? path
    : `${apiBase}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || body.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Require the Electron preload bridge (run/capture only work in the desktop app). */
export function getDesktopApi() {
  if (!window.autoTester) {
    throw new Error(
      'Desktop runtime unavailable. Launch Auto Tester via Electron (npm run desktop:dev).',
    );
  }
  return window.autoTester;
}
