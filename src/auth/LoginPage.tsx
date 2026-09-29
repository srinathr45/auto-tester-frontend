import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Building2, FlaskConical, LogIn } from 'lucide-react';
import { authService } from './services/auth.service';
import type { AuthSession } from './authSession';
import {
  apiOriginFromBase,
  hydrateApiBackendUrl,
  persistApiBackendUrl,
  pingApiBackend,
} from '../shared/apiBackendUrl';
import ThemeToggle from '../theme/ThemeToggle';

interface LoginPageProps {
  onAuthenticated: (session: AuthSession) => void;
}

type AuthView = 'home' | 'login' | 'register';

/**
 * Home chooser with separate Login and Registration cards, then dedicated forms.
 */
export default function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [view, setView] = useState<AuthView>('home');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState('http://127.0.0.1:3001');
  const [apiStatus, setApiStatus] = useState<string | null>(null);

  useEffect(() => {
    void hydrateApiBackendUrl().then((base) => {
      setApiUrl(apiOriginFromBase(base === '/api' ? 'http://127.0.0.1:3001/api' : base));
    });
  }, []);

  const saveBackendUrl = async () => {
    const url = await persistApiBackendUrl(apiUrl);
    setApiUrl(apiOriginFromBase(url));
    return url;
  };

  const goHome = () => {
    setView('home');
    setError(null);
    setPassword('');
  };

  const openView = (next: AuthView) => {
    setView(next);
    setError(null);
    setPassword('');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveBackendUrl();
      const session = await authService.login({ email, password });
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await saveBackendUrl();
      const session = await authService.registerOrganization({
        name,
        email,
        password,
      });
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="page-shell auth-home"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div style={{ position: 'absolute', top: 20, right: 20 }}>
        <ThemeToggle />
      </div>

      <div style={{ width: '100%', maxWidth: 420 }}>
        <div className="brand-mark" style={{ marginBottom: 28, justifyContent: 'center', width: '100%' }}>
          <span className="brand-mark-icon">
            <FlaskConical size={16} strokeWidth={2.25} />
          </span>
          <div className="page-title" style={{ fontSize: '1.35rem' }}>
            Auto Tester
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span className="field-label">Backend URL</span>
          <input
            className="input"
            type="url"
            placeholder="http://127.0.0.1:3001"
            value={apiUrl}
            onChange={(e) => {
              setApiUrl(e.target.value);
              setApiStatus(null);
            }}
            autoComplete="off"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="btn-secondary"
              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setApiStatus(null);
                setError(null);
                try {
                  const url = await persistApiBackendUrl(apiUrl);
                  setApiUrl(apiOriginFromBase(url));
                  const ping = await pingApiBackend(url);
                  setApiStatus(`Connected · ${ping.url}`);
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Could not reach the backend. Check the URL and that the API is running.',
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Test connection
            </button>
            {apiStatus && (
              <span style={{ fontSize: '0.75rem', color: 'var(--accent-green)' }}>{apiStatus}</span>
            )}
          </div>
        </label>

        {error && view === 'home' && (
          <div className="alert-error" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        {view === 'home' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <button type="button" className="auth-portal-card" onClick={() => openView('login')}>
              <span className="auth-portal-icon">
                <LogIn size={22} strokeWidth={2} />
              </span>
              <div className="auth-portal-title">Sign In</div>
              <p className="auth-portal-desc">Access your organization workspace</p>
              <span className="btn-primary auth-portal-cta">
                Sign In
                <ArrowRight size={16} />
              </span>
            </button>

            <button type="button" className="auth-portal-card" onClick={() => openView('register')}>
              <span className="auth-portal-icon">
                <Building2 size={22} strokeWidth={2} />
              </span>
              <div className="auth-portal-title">Register Organization</div>
              <p className="auth-portal-desc">Create a new org and become the owner</p>
              <span className="btn-primary auth-portal-cta">
                Register
                <ArrowRight size={16} />
              </span>
            </button>
          </div>
        )}

        {view === 'login' && (
          <form className="glass-panel auth-form-card" onSubmit={handleLogin}>
            <button type="button" className="btn-secondary auth-back" onClick={goHome}>
              <ArrowLeft size={14} />
              Back
            </button>
            <div className="auth-form-heading">Sign In</div>
            <p className="page-subtitle" style={{ marginBottom: 20, marginTop: 4 }}>
              Sign in with your email and password.
            </p>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span className="field-label">Email</span>
              <input
                className="input"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                autoFocus
              />
            </label>

            <label style={{ display: 'block', marginBottom: 18 }}>
              <span className="field-label">Password</span>
              <input
                className="input"
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                autoComplete="current-password"
              />
            </label>

            {error && (
              <div className="alert-error" style={{ marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Please wait…' : 'Sign in'}
            </button>
          </form>
        )}

        {view === 'register' && (
          <form className="glass-panel auth-form-card" onSubmit={handleRegister}>
            <button type="button" className="btn-secondary auth-back" onClick={goHome}>
              <ArrowLeft size={14} />
              Back
            </button>
            <div className="auth-form-heading">Register Organization</div>
            <p className="page-subtitle" style={{ marginBottom: 20, marginTop: 4 }}>
              Create an organization — you’ll sign in as the owner.
            </p>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span className="field-label">Organization name</span>
              <input
                className="input"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </label>

            <label style={{ display: 'block', marginBottom: 14 }}>
              <span className="field-label">Email</span>
              <input
                className="input"
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>

            <label style={{ display: 'block', marginBottom: 18 }}>
              <span className="field-label">Password</span>
              <input
                className="input"
                required
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
            </label>

            {error && (
              <div className="alert-error" style={{ marginBottom: 14 }}>
                {error}
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Please wait…' : 'Create organization'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
