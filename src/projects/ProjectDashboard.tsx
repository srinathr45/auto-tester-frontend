import { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, Plus, GitBranch, Trash2 } from 'lucide-react';
import { flowService } from '../flows/services/flow.service';
import type { Flow, Project } from '../shared/types';
import ThemeToggle from '../theme/ThemeToggle';

interface ProjectDashboardProps {
  project: Project;
  onBackToProjects: () => void;
  onOpenFlow: (flow: Flow) => void;
  onCreateFlow: () => void;
  onDeleteFlow?: (flowId: number) => void;
}

/**
 * Project home: pick a flow to open in the editor.
 */
export default function ProjectDashboard({
  project,
  onBackToProjects,
  onOpenFlow,
  onCreateFlow,
  onDeleteFlow,
}: ProjectDashboardProps) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const flowList = await flowService.getByProject(project.id);
        if (!mounted) return;
        setFlows(flowList);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [project.id]);

  /** Confirm, delete via Nest (MinIO object too), then refresh local list. */
  const handleDeleteFlow = async (flow: Flow) => {
    if (!confirm(`Delete flow "${flow.name}"? This cannot be undone.`)) return;
    setBusyId(flow.id);
    setError(null);
    try {
      await flowService.remove(flow.id);
      setFlows((prev) => prev.filter((f) => f.id !== flow.id));
      onDeleteFlow?.(flow.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete flow');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-shell-inner" style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <button className="btn-secondary" onClick={onBackToProjects}>
            <ArrowLeft size={16} />
            <span>All projects</span>
          </button>
          <ThemeToggle compact />
        </div>

        <div style={{ marginBottom: 24 }}>
          <div className="page-title">{project.name}</div>
          <div className="meta-line" style={{ marginTop: 6 }}>
            <span>{project.url}</span>
          </div>
        </div>

        {error && (
          <div className="alert-error" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <section className="glass-panel" style={{ padding: 16 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 650, display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem' }}>
              <GitBranch size={15} color="var(--accent)" />
              Flows
              <span style={{ color: 'var(--text-dim)', fontWeight: 500, fontSize: '0.75rem' }}>
                {flows.length}
              </span>
            </div>
            <button className="btn-secondary" style={{ padding: '0.35rem 0.7rem' }} onClick={onCreateFlow}>
              <Plus size={14} />
              <span>New</span>
            </button>
          </div>

          {flows.length === 0 && (
            <div className="empty-state" style={{ padding: '28px 12px' }}>
              No flows yet. Create one to open the editor.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {flows.map((flow) => (
              <div
                key={flow.id}
                className="glass-card"
                style={{
                  padding: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{flow.name}</div>
                  {flow.description && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                      {flow.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    className="btn-primary"
                    style={{ padding: '0.4rem 0.75rem' }}
                    onClick={() => onOpenFlow(flow)}
                    disabled={busyId === flow.id}
                  >
                    <FolderOpen size={14} />
                    <span>Open</span>
                  </button>
                  <button
                    className="btn-danger"
                    style={{ padding: '0.4rem 0.7rem' }}
                    onClick={() => void handleDeleteFlow(flow)}
                    disabled={busyId !== null}
                    title="Delete flow"
                  >
                    <Trash2 size={14} />
                    <span>{busyId === flow.id ? 'Deleting…' : 'Delete'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
