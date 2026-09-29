import { useEffect, useState } from 'react';
import {
  X,
  Pause,
  Play,
  Square,
  CheckCircle,
  AlertTriangle,
  Clock,
  FileSpreadsheet,
} from 'lucide-react';
import { resultService } from '../results/services/result.service';
import type { Result } from '../shared/types';

interface RunPanelProps {
  resultId: number;
  onClose: () => void;
  onProgress?: (result: Result) => void;
  /** When true, fills the parent container instead of floating on the canvas. */
  embedded?: boolean;
}

/**
 * Live run status panel. Polls Electron only — results are not stored in Nest.
 */
export default function RunPanel({
  resultId,
  onClose,
  onProgress,
  embedded,
}: RunPanelProps) {
  const [run, setRun] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    const fetchRun = async () => {
      try {
        const data = await resultService.getLiveRun(resultId);
        if (!mounted) return;
        setRun(data);
        onProgress?.(data);
      } catch (err) {
        console.error('Error fetching live run:', err);
      }
    };
    fetchRun();
    const interval = setInterval(fetchRun, 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [resultId, onProgress]);

  if (!run) return null;

  const status = run.result;
  const isActive = status === 'queued' || status === 'running';
  const isPaused = status === 'paused';
  const isDone = !isActive && !isPaused;
  const color =
    status === 'passed'
      ? 'var(--accent-green)'
      : status === 'failed' || status === 'cancelled'
        ? 'var(--accent-red)'
        : status === 'paused'
          ? 'var(--accent-amber)'
          : 'var(--accent-amber)';

  const handlePause = async () => {
    setBusy(true);
    try {
      await resultService.pause(resultId);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleResume = async () => {
    setBusy(true);
    try {
      await resultService.resume(resultId);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await resultService.stop(resultId);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  const handleDownloadExcel = async () => {
    if (!run) return;
    setBusy(true);
    try {
      await resultService.downloadExcel(run.id);
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : 'Excel download failed');
    } finally {
      setBusy(false);
    }
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
              right: 20,
              bottom: 20,
              width: 300,
              maxHeight: '40vh',
              zIndex: 20,
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
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.8rem' }}>Run #{run.id}</div>
          <div
            style={{
              fontSize: '0.68rem',
              fontWeight: 700,
              color,
              textTransform: 'uppercase',
              marginTop: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {status === 'passed' && <CheckCircle size={11} />}
            {(status === 'failed' || status === 'cancelled') && <AlertTriangle size={11} />}
            {(isActive || isPaused) && <Clock size={11} />}
            {status}
          </div>
        </div>
        <button
          onClick={onClose}
          disabled={!isDone}
          title={isDone ? 'Close' : 'Wait until run finishes or stop it'}
          className="btn-icon"
          style={{
            opacity: isDone ? 1 : 0.35,
            cursor: isDone ? 'pointer' : 'not-allowed',
            border: 'none',
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          gap: 6,
          borderBottom: '1px solid var(--border-color)',
        }}
      >
        {!isPaused && isActive && (
          <button
            className="btn-secondary"
            style={{ padding: '0.3rem 0.55rem', flex: 1, fontSize: '0.72rem' }}
            onClick={handlePause}
            disabled={busy}
          >
            <Pause size={12} />
            Pause
          </button>
        )}
        {isPaused && (
          <button
            className="btn-secondary"
            style={{ padding: '0.3rem 0.55rem', flex: 1, fontSize: '0.72rem' }}
            onClick={handleResume}
            disabled={busy}
          >
            <Play size={12} />
            Resume
          </button>
        )}
        {(isActive || isPaused) && (
          <button
            className="btn-danger"
            style={{
              padding: '0.3rem 0.55rem',
              flex: 1,
              fontSize: '0.72rem',
            }}
            onClick={handleStop}
            disabled={busy}
          >
            <Square size={12} />
            Stop
          </button>
        )}
        {isDone && (
          <button
            className="btn-secondary"
            style={{ padding: '0.3rem 0.55rem', flex: 1, fontSize: '0.72rem' }}
            onClick={handleDownloadExcel}
            disabled={busy}
            title="Download Excel report (also auto-saved to Downloads after Run)"
          >
            <FileSpreadsheet size={12} />
            Excel
          </button>
        )}
      </div>

      <div style={{ overflowY: 'auto', padding: '8px 10px', flex: 1, minHeight: 0 }}>
        {(run.stepProgress || []).map((step, idx) => {
          const stepColor =
            step.status === 'passed'
              ? 'var(--accent-green)'
              : step.status === 'warned'
                ? 'var(--accent-amber)'
                : step.status === 'failed'
                  ? 'var(--accent-red)'
                  : step.status === 'running'
                    ? 'var(--accent)'
                    : 'var(--text-dim)';
          const isCurrent = run.currentNodeId === step.nodeId;
          return (
            <div
              key={step.nodeId}
              style={{
                padding: '8px 10px',
                borderRadius: 6,
                marginBottom: 6,
                border: isCurrent
                  ? '1px solid var(--accent-border)'
                  : '1px solid var(--border-color)',
                background: isCurrent ? 'var(--accent-muted)' : 'transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontWeight: 600, fontSize: '0.75rem' }}>
                  #{idx + 1} {step.name}
                </span>
                <span
                  style={{
                    color: stepColor,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {step.status}
                </span>
              </div>
              {step.errorMessage && (
                <div
                  style={{
                    fontSize: '0.65rem',
                    color: step.status === 'warned' ? 'var(--warn-text)' : 'var(--danger-text)',
                    marginTop: 4,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {step.errorMessage}
                </div>
              )}
            </div>
          );
        })}
        {(!run.stepProgress || run.stepProgress.length === 0) && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', padding: 8 }}>
            Waiting for runner…
          </div>
        )}
      </div>

      {run.errorMessage && (
        <div
          style={{
            padding: '8px 12px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.68rem',
            color: 'var(--danger-text)',
            maxHeight: 48,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {run.errorMessage}
        </div>
      )}
    </div>
  );
}
