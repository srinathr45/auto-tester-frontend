import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { stepService } from '../../steps/services/step.service';
import type { Step } from '../../shared/types';

interface StepSearchProps {
  projectId: number | undefined;
  onSelectStep: (step: Step) => void;
}

/**
 * Searches steps by name within the current project (backend LIKE filter).
 */
export default function StepSearch({ projectId, onSelectStep }: StepSearchProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!projectId || query.trim().length < 1) {
      setHits([]);
      return;
    }

    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const rows = await stepService.search({ projectId, name: query.trim() });
        setHits(rows);
      } catch (err) {
        console.error(err);
        setHits([]);
      } finally {
        setBusy(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [projectId, query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative' }}>
        <Search
          size={14}
          style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-muted)' }}
        />
        <input
          className="input"
          style={{ paddingLeft: 32 }}
          placeholder="Search steps in project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!projectId}
        />
      </div>
      {busy && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Searching…</div>}
      {hits.length > 0 && (
        <div
          style={{
            maxHeight: 140,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {hits.map((step) => (
            <button
              key={`${step.flowId}-${step.nodeId || step.name}`}
              className="glass-card"
              style={{
                padding: '8px 10px',
                textAlign: 'left',
                cursor: 'pointer',
                color: 'inherit',
                width: '100%',
                fontSize: '0.75rem',
              }}
              onClick={() => {
                onSelectStep(step);
                setQuery('');
                setHits([]);
              }}
            >
              <div style={{ fontWeight: 600 }}>{step.name}</div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
                flow #{step.flowId}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
