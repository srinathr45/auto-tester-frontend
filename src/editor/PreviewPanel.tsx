import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { ExternalLink, MonitorPlay, PanelBottom } from 'lucide-react';

type Viewport = { width: number; height: number };

interface PreviewPanelProps {
  interactive?: boolean;
  /** Hide the built-in title bar (parent provides chrome). */
  hideHeader?: boolean;
  /** Status / actions rendered by parent when hideHeader is true. */
  onStatusChange?: (active: boolean) => void;
  onPopOut?: () => void;
  onDock?: () => void;
  mode?: 'docked' | 'dialog';
}

/**
 * Browser preview: CDP screencast frames from Electron, with pointer/keyboard
 * forwarded into the Playwright page during capture/run.
 */
export default function PreviewPanel({
  interactive = true,
  hideHeader = false,
  onStatusChange,
  onPopOut,
  onDock,
  mode = 'docked',
}: PreviewPanelProps) {
  const [active, setActive] = useState(false);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ width: 1280, height: 720 });
  const imgRef = useRef<HTMLImageElement | null>(null);
  const lastObjectUrl = useRef<string | null>(null);

  useEffect(() => {
    const api = window.autoTester;
    if (!api?.onPreviewFrame || !api?.onPreviewStatus) return;

    void api.getPreviewStatus?.().then((s) => {
      const next = Boolean(s?.active);
      setActive(next);
      onStatusChange?.(next);
      if (s?.viewport) setViewport(s.viewport);
    });

    const offFrame = api.onPreviewFrame((payload) => {
      if (!payload?.data) return;
      if (payload.viewport) setViewport(payload.viewport);
      setFrameUrl(`data:image/jpeg;base64,${payload.data}`);
      setActive(true);
      onStatusChange?.(true);
    });

    const offStatus = api.onPreviewStatus((payload) => {
      const next = Boolean(payload?.active);
      setActive(next);
      onStatusChange?.(next);
      if (payload?.viewport) setViewport(payload.viewport);
      if (!payload?.active) setFrameUrl(null);
    });

    return () => {
      offFrame();
      offStatus();
      if (lastObjectUrl.current) {
        URL.revokeObjectURL(lastObjectUrl.current);
        lastObjectUrl.current = null;
      }
    };
  }, [onStatusChange]);

  const mapPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = imgRef.current;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      const x = ((clientX - rect.left) / rect.width) * viewport.width;
      const y = ((clientY - rect.top) / rect.height) * viewport.height;
      return {
        x: Math.max(0, Math.min(viewport.width, x)),
        y: Math.max(0, Math.min(viewport.height, y)),
      };
    },
    [viewport],
  );

  const sendInput = useCallback(
    async (event: Parameters<NonNullable<typeof window.autoTester>['previewInput']>[0]) => {
      if (!interactive || !window.autoTester?.previewInput) return;
      try {
        await window.autoTester.previewInput(event);
      } catch (err) {
        console.error('preview input failed', err);
      }
    },
    [interactive],
  );

  const onPointer = (type: 'mousemove' | 'mousedown' | 'mouseup') =>
    (e: ReactMouseEvent) => {
      if (!active || !interactive) return;
      e.preventDefault();
      const pt = mapPoint(e.clientX, e.clientY);
      if (!pt) return;
      const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
      void sendInput({ type, ...pt, button });
    };

  const statusChip = (
    <span
      style={{
        fontSize: '0.65rem',
        color: active ? 'var(--accent-green)' : 'var(--text-dim)',
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
      }}
    >
      {active ? 'Live' : 'Idle'}
    </span>
  );

  let headerActions: ReactNode = null;
  if (!hideHeader) {
    headerActions = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {statusChip}
        {mode === 'docked' && onPopOut && (
          <button
            type="button"
            className="btn-icon"
            style={{ width: 26, height: 26 }}
            onClick={onPopOut}
            title="Open preview full screen"
            aria-label="Open preview full screen"
          >
            <ExternalLink size={12} />
          </button>
        )}
        {mode === 'dialog' && onDock && (
          <button
            type="button"
            className="btn-secondary"
            style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
            onClick={onDock}
            title="Dock preview back into the workbench"
          >
            <PanelBottom size={12} />
            Dock
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="editor-col">
      {!hideHeader && (
        <div className="editor-col-header">
          <span>Preview</span>
          {headerActions}
        </div>
      )}

      <div className="preview-stage">
        {!frameUrl && (
          <div className="preview-empty">
            <MonitorPlay size={36} style={{ marginBottom: 12, opacity: 0.5 }} />
            <h3>Browser preview</h3>
            <p>
              Run a flow or start Capture — the page appears here. During capture, click and type
              in this panel.
            </p>
          </div>
        )}

        {frameUrl && (
          <img
            ref={imgRef}
            src={frameUrl}
            alt="Browser preview"
            className={`preview-frame${interactive && active ? ' is-interactive' : ''}`}
            draggable={false}
            tabIndex={interactive ? 0 : -1}
            onContextMenu={(e) => e.preventDefault()}
            onMouseMove={onPointer('mousemove')}
            onMouseDown={onPointer('mousedown')}
            onMouseUp={onPointer('mouseup')}
            onClick={(e) => {
              e.preventDefault();
              imgRef.current?.focus();
            }}
            onDoubleClick={(e) => e.preventDefault()}
            onWheel={(e) => {
              if (!active || !interactive) return;
              e.preventDefault();
              const pt = mapPoint(e.clientX, e.clientY);
              if (!pt) return;
              void sendInput({
                type: 'wheel',
                ...pt,
                deltaX: e.deltaX,
                deltaY: e.deltaY,
              });
            }}
            onKeyDown={(e) => {
              if (!active || !interactive) return;
              e.preventDefault();
              if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                void sendInput({ type: 'type', text: e.key });
              } else {
                void sendInput({ type: 'keydown', key: e.key });
              }
            }}
            onKeyUp={(e) => {
              if (!active || !interactive) return;
              if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
                void sendInput({ type: 'keyup', key: e.key });
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Live/Idle + pop-out controls for a parent floating header. */
export function PreviewHeaderActions({
  active,
  onPopOut,
}: {
  active: boolean;
  onPopOut?: () => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontSize: '0.65rem',
          color: active ? 'var(--accent-green)' : 'var(--text-dim)',
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {active ? 'Live' : 'Idle'}
      </span>
      {onPopOut && (
        <button
          type="button"
          className="btn-icon"
          style={{ width: 26, height: 26 }}
          onClick={onPopOut}
          title="Open preview full screen"
          aria-label="Open preview full screen"
        >
          <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}
