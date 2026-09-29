import { Plus, GitBranch } from 'lucide-react';
import type { Flow } from '../../shared/types';

interface FlowListProps {
  flows: Flow[];
  selectedFlowId: number | undefined;
  onSelectFlow: (flow: Flow) => void;
  onCreateFlow: () => void;
}

export default function FlowList({
  flows,
  selectedFlowId,
  onSelectFlow,
  onCreateFlow,
}: FlowListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        <div style={{ fontSize: '0.8rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <GitBranch size={14} />
          Flows
        </div>
        <button
          className="btn-secondary"
          style={{ padding: '0.25rem 0.45rem' }}
          onClick={onCreateFlow}
          title="New flow"
        >
          <Plus size={14} />
        </button>
      </div>

      {flows.length === 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>
          No flows yet.
        </div>
      )}

      {flows.map((flow) => {
        const active = flow.id === selectedFlowId;
        return (
          <button
            key={flow.id}
            onClick={() => onSelectFlow(flow)}
            className="glass-card"
            style={{
              padding: '10px 12px',
              textAlign: 'left',
              cursor: 'pointer',
              border: active ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
              background: active ? 'rgba(0, 242, 254, 0.08)' : undefined,
              color: 'inherit',
              width: '100%',
            }}
          >
            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{flow.name}</div>
            {flow.description && (
              <div
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {flow.description}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
