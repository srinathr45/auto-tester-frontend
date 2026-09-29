import { useEffect, useState } from 'react';
import { UserPlus, Trash2, X } from 'lucide-react';
import { authService, type OrgUser } from './services/auth.service';

interface ManageUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Org-admin UI to create and list member users under the organization.
 */
export default function ManageUsersModal({ isOpen, onClose }: ManageUsersModalProps) {
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const list = await authService.listUsers();
    setUsers(list);
  };

  useEffect(() => {
    if (!isOpen) return;
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : 'Failed to load users'),
    );
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authService.createUser({ name, email, password });
      setName('');
      setEmail('');
      setPassword('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (user: OrgUser) => {
    if (!confirm(`Delete user "${user.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await authService.deleteUser(user.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1000 }}>
      <div
        className="modal-panel"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title">Organization users</div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleCreate} style={{ display: 'grid', gap: 10 }}>
          <input
            className="input"
            required
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="input"
            required
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            required
            type="password"
            placeholder="Password"
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button className="btn-primary" type="submit" disabled={busy}>
            <UserPlus size={14} />
            <span>Create user</span>
          </button>
        </form>

        {error && <div className="alert-error">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No users yet. Create one above.
            </div>
          )}
          {users.map((u) => (
            <div
              key={u.id}
              className="glass-card"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 12px',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{u.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{u.email}</div>
              </div>
              <button className="btn-danger" style={{ padding: '0.35rem 0.55rem' }} onClick={() => handleDelete(u)} disabled={busy}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
