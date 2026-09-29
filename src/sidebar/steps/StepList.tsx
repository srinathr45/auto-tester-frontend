import { FileCode, ListOrdered } from 'lucide-react';
import type { FlowNode } from '../../shared/types';

interface StepListProps {
  nodes: FlowNode[];
  selectedNodeId: string | null;
  highlightedNodeId?: string | null;
  onSelectNode: (nodeId: string) => void;
}

export default function StepList({
  nodes,
  selectedNodeId,
  highlightedNodeId,
  onSelectNode,
}: StepListProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingBottom: 8,
          borderBottom: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          fontWeight: 700,
        }}
      >
        <ListOrdered size={14} />
        Steps (start → end)
      </div>

      <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {nodes.length === 0 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '8px 0' }}>
            No steps yet. Click Add step to create one.
          </div>
        )}

        {nodes.map((node, index) => {
          const active = node.id === selectedNodeId;
          const running = node.id === highlightedNodeId;
          const preview = (node.data.scriptText || '').trim().split('\n')[0] || 'Empty script';
          return (
            <button
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              className="glass-card"
              style={{
                padding: '10px 12px',
                textAlign: 'left',
                cursor: 'pointer',
                border: running
                  ? '1px solid #00f2fe'
                  : active
                    ? '1px solid #fbbf24'
                    : '1px solid var(--border-color)',
                background: running
                  ? 'rgba(0, 242, 254, 0.12)'
                  : active
                    ? 'rgba(251, 191, 36, 0.1)'
                    : undefined,
                boxShadow: running ? '0 0 12px rgba(0, 242, 254, 0.25)' : undefined,
                color: 'inherit',
                width: '100%',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>#{index + 1}</span>
                <FileCode size={12} style={{ color: '#fbbf24' }} />
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{node.data.label || 'Step'}</span>
              </div>
              <div
                style={{
                  fontSize: '0.68rem',
                  color: 'var(--text-muted)',
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {preview}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
