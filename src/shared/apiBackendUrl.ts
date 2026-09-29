const STORAGE_KEY = 'auto_tester_api_backend_url';
export const DEFAULT_API_BACKEND_ORIGIN = 'http://127.0.0.1:3001';

let overrideBase: string | null = null;

/**
 * Accept host, origin, or full /api URL and always return `{origin}/api`.
 * Examples: `10.0.0.8:3001`, `https://api.example.com`, `https://api.example.com/api/`
 */
export function normalizeApiBackendUrl(raw?: string | null): string {
  let url = String(raw || '').trim();
  if (!url) url = DEFAULT_API_BACKEND_ORIGIN;
  url = url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/api$/i.test(url)) url = `${url}/api`;
  return url;
}

export function apiOriginFromBase(apiBase: string): string {
  return apiBase.replace(/\/api$/i, '');
}

export function setApiBackendUrl(raw: string): string {
  const url = normalizeApiBackendUrl(raw);
  overrideBase = url;
  try {
    localStorage.setItem(STORAGE_KEY, url);
  } catch {
    /* ignore quota / private mode */
  }
  return url;
}

export function peekStoredApiBackendUrl(): string | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeApiBackendUrl(stored) : null;
  } catch {
    return null;
  }
}

function envApiBackendUrl(): string | undefined {
  const vite = import.meta.env as {
    VITE_API_BACKEND_URL?: string;
    VITE_API_URL?: string;
  };
  return vite.VITE_API_BACKEND_URL || vite.VITE_API_URL;
}

/** Nest CRUD base, including `/api`. */
export function getApiBase(): string {
  if (overrideBase) return overrideBase;
  const stored = peekStoredApiBackendUrl();
  if (stored) return stored;
  const fromEnv = envApiBackendUrl();
  if (fromEnv) return normalizeApiBackendUrl(fromEnv);
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:') {
    return normalizeApiBackendUrl(DEFAULT_API_BACKEND_ORIGIN);
  }
  return '/api';
}

/** Load Electron-persisted or env URL before the first API call. */
export async function hydrateApiBackendUrl(): Promise<string> {
  const fromDesktop = await window.autoTester?.getApiBackendUrl?.().catch(() => '');
  if (fromDesktop) return setApiBackendUrl(fromDesktop);
  const stored = peekStoredApiBackendUrl();
  if (stored) {
    void window.autoTester?.setApiBackendUrl?.(stored);
    return setApiBackendUrl(stored);
  }
  const fromEnv = envApiBackendUrl();
  if (fromEnv) return setApiBackendUrl(fromEnv);
  overrideBase = getApiBase() === '/api' ? null : getApiBase();
  return getApiBase();
}

export async function persistApiBackendUrl(raw: string): Promise<string> {
  const url = setApiBackendUrl(raw);
  await window.autoTester?.setApiBackendUrl?.(url);
  return url;
}

export async function pingApiBackend(raw?: string): Promise<{ ok: boolean; url: string }> {
  const url = normalizeApiBackendUrl(raw || getApiBase());
  const res = await fetch(`${url}/health`, { method: 'GET' });
  if (!res.ok) throw new Error(`Backend health failed (${res.status})`);
  return { ok: true, url };
}
