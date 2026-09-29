import { useCallback, useEffect, useState } from 'react';
import { X, Download, Upload, Save } from 'lucide-react';
import { artifactService } from '../results/services/artifact.service';
import { manualService, type Manual, type ManualStep } from './services/manual.service';

interface ManualEditorProps {
  flowId: number;
  projectId: number;
  /** Existing manual id — always created by the parent before open. */
  manualId: number;
  onClose: () => void;
}

/**
 * Editable manual: step name/description + before/after screenshots.
 * Auto-capture runs in Electron; this UI polls until shots appear.
 */
export default function ManualEditor({
  flowId,
  projectId,
  manualId,
  onClose,
}: ManualEditorProps) {
  const [manual, setManual] = useState<Manual | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const m = await manualService.getById(manualId);
    setManual(m);
    setTitle(m.title);
    return m;
  }, [manualId]);

  useEffect(() => {
    let mounted = true;
    setLoadError(null);
    setManual(null);
    void (async () => {
      try {
        const m = await manualService.getById(manualId);
        if (!mounted) return;
        setManual(m);
        setTitle(m.title);
      } catch (err) {
        console.error(err);
        if (!mounted) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load manual');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [manualId]);

  // Poll while any step is still missing auto screenshots (capture in progress).
  useEffect(() => {
    if (!manual) return;
    const steps = manual.steps || [];
    const incomplete = steps.some(
      (s) => !s.beforeScreenshotArtifactId || !(s.afterScreenshotArtifactId || s.screenshotArtifactId),
    );
    if (!incomplete) return;

    const id = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 1500);
    return () => clearInterval(id);
  }, [manual, refresh]);

  const handleSaveTitle = async () => {
    if (!manual) return;
    setBusy(true);
    try {
      await manualService.update(manual.id, { title });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleStepChange = async (
    step: ManualStep,
    patch: Partial<{ name: string; description: string | null }>,
  ) => {
    if (!manual) return;
    try {
      await manualService.updateStep(manual.id, step.id, patch);
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpload = async (step: ManualStep, file: File, phase: 'before' | 'after') => {
    if (!manual) return;
    setBusy(true);
    try {
      const art = await artifactService.upload({
        file,
        projectId,
        flowId,
        manualId: manual.id,
        stepNodeId: `${step.stepNodeId || `manual-step-${step.id}`}-${phase}`,
        kind: 'manual_screenshot',
      });
      await manualService.updateStep(manual.id, step.id, {
        ...(phase === 'before'
          ? { beforeScreenshotArtifactId: art.id }
          : {
              afterScreenshotArtifactId: art.id,
              screenshotArtifactId: art.id,
            }),
      });
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = async () => {
    if (!manual) return;
    setBusy(true);
    try {
      await manualService.exportPdf(manual);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <div className="modal-overlay">
        <div className="modal-panel" style={{ maxWidth: 420 }}>
          <div className="alert-error" style={{ marginBottom: 12 }}>
            {loadError}
          </div>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  if (!manual) {
    return (
      <div className="modal-overlay" style={{ color: 'var(--text-muted)' }}>
        Loading manual…
      </div>
    );
  }

  const steps = manual.steps || [];
  const capturing = steps.some(
    (s) => !s.beforeScreenshotArtifactId || !(s.afterScreenshotArtifactId || s.screenshotArtifactId),
  );

  return (
    <div className="modal-overlay">
      <div
        className="modal-panel"
        style={{
          maxWidth: 720,
          width: '100%',
          padding: 0,
          gap: 0,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 16,
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn-secondary"
            onClick={handleSaveTitle}
            disabled={busy}
            style={{ padding: '0.35rem 0.65rem' }}
          >
            <Save size={14} />
            Save
          </button>
          <button
            className="btn-secondary"
            onClick={handleExport}
            disabled={busy}
            style={{ padding: '0.35rem 0.65rem' }}
          >
            <Download size={14} />
            Download PDF
          </button>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Close" style={{ border: 'none' }}>
            <X size={18} />
          </button>
        </div>

        {capturing && (
          <div className="alert-info">Capturing before/after screenshots… (watch Run panel; images appear below)</div>
        )}

        <div style={{ padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((step, idx) => {
            const afterId = step.afterScreenshotArtifactId || step.screenshotArtifactId;
            return (
              <div
                key={step.id}
                className="glass-card"
                style={{
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
                  STEP {idx + 1}
                </div>
                <input
                  className="input"
                  defaultValue={step.name}
                  onBlur={(e) => {
                    if (e.target.value !== step.name) {
                      void handleStepChange(step, { name: e.target.value });
                    }
                  }}
                />
                <textarea
                  className="input"
                  rows={3}
                  defaultValue={step.description || ''}
                  placeholder="Step description…"
                  onBlur={(e) => {
                    const next = e.target.value || null;
                    if (next !== (step.description || null)) {
                      void handleStepChange(step, { description: next });
                    }
                  }}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      Before
                    </div>
                    {step.beforeScreenshotArtifactId ? (
                      <img
                        src={artifactService.downloadUrl(step.beforeScreenshotArtifactId)}
                        alt={`${step.name} before`}
                        style={{
                          width: '100%',
                          maxHeight: 160,
                          objectFit: 'contain',
                          borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          background: 'var(--preview-stage)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: 80,
                          borderRadius: 6,
                          border: '1px dashed var(--border-color)',
                          color: 'var(--text-dim)',
                          fontSize: '0.7rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        Waiting…
                      </div>
                    )}
                    <label
                      className="btn-secondary"
                      style={{
                        padding: '0.3rem 0.5rem',
                        marginTop: 6,
                        fontSize: '0.7rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Upload size={12} />
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUpload(step, file, 'before');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  <div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      After
                    </div>
                    {afterId ? (
                      <img
                        src={artifactService.downloadUrl(afterId)}
                        alt={`${step.name} after`}
                        style={{
                          width: '100%',
                          maxHeight: 160,
                          objectFit: 'contain',
                          borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          background: 'var(--preview-stage)',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          height: 80,
                          borderRadius: 6,
                          border: '1px dashed var(--border-color)',
                          color: 'var(--text-dim)',
                          fontSize: '0.7rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        Waiting…
                      </div>
                    )}
                    <label
                      className="btn-secondary"
                      style={{
                        padding: '0.3rem 0.5rem',
                        marginTop: 6,
                        fontSize: '0.7rem',
                        cursor: busy ? 'not-allowed' : 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Upload size={12} />
                      Upload
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUpload(step, file, 'after');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                </div>
              </div>
            );
          })}
          {steps.length === 0 && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
              No steps — add steps to the flow first, then create a new manual.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
