import { useState } from 'react';
import { FolderPlus, Trash2, FolderOpen, Globe, LogOut, Users, FlaskConical } from 'lucide-react';
import type { AuthSession } from '../auth/authSession';
import type { Project } from '../shared/types';
import ThemeToggle from '../theme/ThemeToggle';

interface ProjectMenuProps {
  projects: Project[];
  session: AuthSession;
  onOpenProject: (project: Project) => void;
  onCreateProject: () => void;
  onDeleteProject: (id: number) => Promise<void>;
  onManageUsers: () => void;
  onLogout: () => void;
}

export default function ProjectMenu({
  projects,
  session,
  onOpenProject,
  onCreateProject,
  onDeleteProject,
  onManageUsers,
  onLogout,
}: ProjectMenuProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async (project: Project) => {
    if (!confirm(`Delete project "${project.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await onDeleteProject(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-shell-inner">
        <div
          style={{
            marginBottom: 32,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div className="brand-mark" style={{ marginBottom: 10 }}>
              <span className="brand-mark-icon">
                <FlaskConical size={16} strokeWidth={2.25} />
              </span>
              <div className="page-title">Auto Tester</div>
            </div>
            <p className="page-subtitle">
              Create a project, build a linear flow of steps, and run Playwright scripts with an in-app
              browser preview.
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{session.name}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {session.email} · {session.role}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <ThemeToggle compact />
              {session.role === 'owner' && (
                <button className="btn-secondary" onClick={onManageUsers}>
                  <Users size={14} />
                  <span>Users</span>
                </button>
              )}
              <button className="btn-secondary" onClick={onLogout}>
                <LogOut size={14} />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
          <button className="btn-primary" onClick={onCreateProject} disabled={busy}>
            <FolderPlus size={16} />
            <span>New Project</span>
          </button>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>
            {projects.length} project{projects.length === 1 ? '' : 's'}
          </span>
        </div>

        {error && (
          <div className="alert-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {projects.length === 0 && (
            <div className="glass-panel empty-state">No projects yet. Create one to get started.</div>
          )}

          {projects.map((p) => (
            <div key={p.id} className="glass-panel list-row">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="list-row-title">{p.name}</div>
                <div className="meta-line">
                  <Globe size={12} />
                  <span>{p.url}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button
                  className="btn-primary"
                  style={{ padding: '0.4rem 0.8rem' }}
                  onClick={() => onOpenProject(p)}
                  disabled={busy}
                >
                  <FolderOpen size={14} />
                  <span>Open</span>
                </button>
                <button className="btn-danger" style={{ padding: '0.4rem 0.65rem' }} onClick={() => handleDelete(p)} disabled={busy}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
