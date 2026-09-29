const AUTH_STORAGE_KEY = 'auto_tester_auth';

export type AuthSession = {
  accessToken: string;
  /** owner registered the org; member was invited. */
  role: 'owner' | 'member';
  id: number;
  name: string;
  email: string;
  organizationId: number | null;
};

/** Read the persisted login session from localStorage (null if logged out). */
export function getAuthSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed?.accessToken) return null;
    // Migrate old sessions that used principalType.
    if (!parsed.role && (parsed as { principalType?: string }).principalType) {
      const legacy = parsed as AuthSession & { principalType?: string };
      parsed.role = legacy.principalType === 'organization' ? 'owner' : 'member';
    }
    if (!parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function getAccessToken(): string | null {
  return getAuthSession()?.accessToken ?? null;
}

/** Persist session and push the JWT to Electron main for Nest uploads. */
export function setAuthSession(session: AuthSession | null) {
  if (session) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } else {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }
  void window.autoTester?.setAuthToken?.(session?.accessToken ?? null);
}

export function clearAuthSession() {
  setAuthSession(null);
}
