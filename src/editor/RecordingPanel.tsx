import { useEffect, useRef, useState } from 'react';
import { X, Play, Square, Plus, ExternalLink } from 'lucide-react';
import { recordingService, type RecordingEvent } from '../recording/services/recording.service';
import type { Flow, FlowEdge, FlowNode, Project } from '../shared/types';

interface RecordingPanelProps {
  project: Project | null;
  flow: Flow | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNode: FlowNode;
  onInsertScript: (lines: string) => void;
  onClose: () => void;
  /** When true, fills the parent container instead of floating on the canvas. */
  embedded?: boolean;
  /** Parent dialog already shows title/close. */
  hideHeader?: boolean;
  /** Docked mode: offer moving Capture into a popup. */
  onPopOut?: () => void;
}

/**
 * Action capturer. Electron runs prior steps, then records clicks/fills via Preview panel.
 */
export default function RecordingPanel({
  project,
  flow,
  nodes,
  edges,
  selectedNode,
  onInsertScript,
  onClose,
  embedded,
  hideHeader,
  onPopOut,
}: RecordingPanelProps) {
  const [url, setUrl] = useState(project?.url || 'https://example.com');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<RecordingEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastIdRef = useRef(0);

  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    const tick = async () => {
      try {
        const fresh = await recordingService.events(sessionId, lastIdRef.current);
        if (!mounted || !fresh.length) return;
        lastIdRef.current = fresh[fresh.length - 1].id;
        setEvents((prev) => [...prev, ...fresh]);
      } catch (err) {
        console.error(err);
      }
    };
    tick();
    const interval = setInterval(tick, 800);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [sessionId]);

  const handleStart = async () => {
    if (!project) {
      setError('No project selected');
      return;
    }
    if (!flow) {
      setError('No flow selected');
      return;
    }
    setBusy(true);
    setError(null);
    setEvents([]);
    lastIdRef.current = 0;
    setStatusText('Preparing… running prior steps, then recording');
    try {
      if (sessionId) {
        await recordingService.stop(sessionId).catch(() => undefined);
        setSessionId(null);
      }
      const res = await recordingService.start({
        untilNodeId: selectedNode.id,
        url,
        projectUrl: project.url,
        nodes,
        edges,
      });
      setSessionId(res.sessionId);
      setStatusText(
        res.warmedUpSteps > 0
          ? `Recording… (ran ${res.warmedUpSteps} prior step${res.warmedUpSteps === 1 ? '' : 's'}). Click in Preview.`
          : 'Recording… interact in the Preview panel.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start capture');
      setStatusText(null);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    if (!sessionId) return;
    setBusy(true);
    try {
      await recordingService.stop(sessionId);
      setSessionId(null);
      setStatusText(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop capture');
    } finally {
      setBusy(false);
    }
  };

  const handleInsert = () => {
    if (!events.length) return;
    const lines = events.map((e) => e.scriptLine).join('\n') + '\n';
    onInsertScript(lines);
  };

  const handleClose = async () => {
    if (sessionId) {
      try {
        await recordingService.stop(sessionId);
      } catch {
        // ignore
      }
    }
    onClose();
  };

  return (
    <div
      className="glass-panel"
      style={
        embedded
          ? {
              width: '100%',
              height: '100%',
              maxHeight: 'none',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: 0,
              border: 'none',
              borderRadius: 0,
              boxShadow: 'none',
            }
          : {
              position: 'absolute',
              left: 20,
              bottom: 20,
              width: 320,
              maxHeight: '45vh',
              zIndex: 21,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              padding: 0,
            }
      }
    >
      <div
        style={{
          padding: '10px 12px',
          borderBottom: hideHeader ? undefined : '1px solid var(--border-color)',
          display: hideHeader ? 'none' : 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>Action Capture</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
            Step: {selectedNode.data.label || selectedNode.id}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {onPopOut && (
            <button
              type="button"
              className="btn-icon"
              style={{ border: 'none', width: 26, height: 26 }}
              onClick={onPopOut}
              title="Open Capture full screen"
              aria-label="Open Capture full screen"
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={handleClose}
            className="btn-icon"
            style={{ border: 'none' }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={Boolean(sessionId) || busy}
          placeholder="URL to capture"
        />
        <div style={{ display: 'flex', gap: 6 }}>
          {!sessionId ? (
            <button
              className="btn-primary"
              style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
              onClick={handleStart}
              disabled={busy}
            >
              <Play size={12} />
              {busy ? 'Preparing…' : 'Start'}
            </button>
          ) : (
            <button
              className="btn-danger"
              style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
              onClick={handleStop}
              disabled={busy}
            >
              <Square size={12} />
              Stop
            </button>
          )}
          <button
            className="btn-secondary"
            style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}
            onClick={handleInsert}
            disabled={!events.length}
          >
            <Plus size={12} />
            Insert
          </button>
        </div>
        {error && <div style={{ fontSize: '0.7rem', color: 'var(--danger-text)' }}>{error}</div>}
        {statusText && (
          <div style={{ fontSize: '0.68rem', color: sessionId ? 'var(--success-text)' : 'var(--warn-text)' }}>
            {statusText}
          </div>
        )}
      </div>

      <div style={{ overflowY: 'auto', padding: '0 10px 10px', flex: 1, minHeight: 0 }}>
        {events.length === 0 && (
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', padding: 8 }}>
            Prior steps run first, then captured actions appear here.
          </div>
        )}
        {events.map((ev) => (
          <div
            key={ev.id}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              marginBottom: 6,
              fontSize: '0.7rem',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{ev.detail}</div>
            <code style={{ color: 'var(--accent-amber)', fontSize: '0.65rem' }}>{ev.scriptLine}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
