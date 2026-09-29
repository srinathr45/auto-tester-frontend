import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Maximize2, Minimize2, X } from 'lucide-react';

export type PanelRect = { x: number; y: number; w: number; h: number };

type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function loadRect(key: string, fallback: PanelRect): PanelRect {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PanelRect>;
    if (
      typeof parsed.x === 'number' &&
      typeof parsed.y === 'number' &&
      typeof parsed.w === 'number' &&
      typeof parsed.h === 'number'
    ) {
      return { x: parsed.x, y: parsed.y, w: parsed.w, h: parsed.h };
    }
  } catch {
    // ignore
  }
  return fallback;
}

function saveRect(key: string, rect: PanelRect) {
  try {
    localStorage.setItem(key, JSON.stringify(rect));
  } catch {
    // ignore
  }
}

function clampRect(
  rect: PanelRect,
  bounds: { w: number; h: number },
  minW: number,
  minH: number,
): PanelRect {
  const w = Math.max(minW, Math.min(rect.w, bounds.w));
  const h = Math.max(minH, Math.min(rect.h, bounds.h));
  const x = Math.max(0, Math.min(rect.x, Math.max(0, bounds.w - w)));
  const y = Math.max(0, Math.min(rect.y, Math.max(0, bounds.h - h)));
  return { x, y, w, h };
}

interface FloatingPanelProps {
  id: string;
  title: string;
  storageKey: string;
  defaultRect: PanelRect;
  minWidth?: number;
  minHeight?: number;
  zIndex: number;
  onFocus: () => void;
  visible: boolean;
  onClose?: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  headerActions?: ReactNode;
  /** Extra class on the panel shell */
  className?: string;
  children: ReactNode;
}

/**
 * Draggable / corner-resizable window inside the editor workbench.
 */
export default function FloatingPanel({
  id,
  title,
  storageKey,
  defaultRect,
  minWidth = 240,
  minHeight = 180,
  zIndex,
  onFocus,
  visible,
  onClose,
  maximized = false,
  onToggleMaximize,
  headerActions,
  className,
  children,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<PanelRect>(() => loadRect(storageKey, defaultRect));
  const beforeMaxRef = useRef<PanelRect | null>(null);
  const dragRef = useRef<{
    mode: 'move' | ResizeEdge;
    startX: number;
    startY: number;
    origin: PanelRect;
  } | null>(null);

  const getBounds = useCallback(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return { w: window.innerWidth, h: window.innerHeight };
    return { w: parent.clientWidth, h: parent.clientHeight };
  }, []);

  // Re-clamp when workbench resizes
  useEffect(() => {
    const parent = panelRef.current?.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(() => {
      if (maximized) return;
      setRect((prev) => clampRect(prev, getBounds(), minWidth, minHeight));
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [getBounds, maximized, minWidth, minHeight]);

  useEffect(() => {
    if (maximized) return;
    saveRect(storageKey, rect);
  }, [rect, storageKey, maximized]);

  useEffect(() => {
    if (maximized) {
      if (!beforeMaxRef.current) beforeMaxRef.current = rect;
      const b = getBounds();
      setRect({ x: 0, y: 0, w: b.w, h: b.h });
    } else if (beforeMaxRef.current) {
      const restored = clampRect(beforeMaxRef.current, getBounds(), minWidth, minHeight);
      beforeMaxRef.current = null;
      setRect(restored);
    }
    // Only react to maximize toggles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maximized]);

  const onPointerMove = useCallback(
    (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const bounds = getBounds();
      const o = drag.origin;

      if (drag.mode === 'move') {
        setRect(clampRect({ ...o, x: o.x + dx, y: o.y + dy }, bounds, minWidth, minHeight));
        return;
      }

      let { x, y, w, h } = o;
      const edge = drag.mode;
      if (edge.includes('e')) w = o.w + dx;
      if (edge.includes('w')) {
        w = o.w - dx;
        x = o.x + dx;
      }
      if (edge.includes('s')) h = o.h + dy;
      if (edge.includes('n')) {
        h = o.h - dy;
        y = o.y + dy;
      }

      if (w < minWidth) {
        if (edge.includes('w')) x = o.x + o.w - minWidth;
        w = minWidth;
      }
      if (h < minHeight) {
        if (edge.includes('n')) y = o.y + o.h - minHeight;
        h = minHeight;
      }

      setRect(clampRect({ x, y, w, h }, bounds, minWidth, minHeight));
    },
    [getBounds, minWidth, minHeight],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    document.body.classList.remove('is-floating-drag');
    window.removeEventListener('mousemove', onPointerMove);
    window.removeEventListener('mouseup', endDrag);
  }, [onPointerMove]);

  const startDrag = (mode: 'move' | ResizeEdge) => (e: ReactMouseEvent) => {
    if (maximized) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origin: rect,
    };
    document.body.classList.add('is-floating-drag');
    window.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', endDrag);
  };

  useEffect(() => () => endDrag(), [endDrag]);

  if (!visible) return null;

  return (
    <div
      ref={panelRef}
      id={id}
      className={`floating-panel${maximized ? ' is-maximized' : ''}${className ? ` ${className}` : ''}`}
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        zIndex,
      }}
      onMouseDown={() => onFocus()}
    >
      <div className="floating-panel-header" onMouseDown={startDrag('move')}>
        <span className="floating-panel-title">{title}</span>
        <div className="floating-panel-actions" onMouseDown={(e) => e.stopPropagation()}>
          {headerActions}
          {onToggleMaximize && (
            <button
              type="button"
              className="btn-icon"
              style={{ width: 26, height: 26 }}
              onClick={onToggleMaximize}
              title={maximized ? 'Restore' : 'Maximize'}
              aria-label={maximized ? 'Restore' : 'Maximize'}
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
          {onClose && (
            <button
              type="button"
              className="btn-icon"
              style={{ width: 26, height: 26 }}
              onClick={onClose}
              title="Hide panel"
              aria-label="Hide panel"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="floating-panel-body">{children}</div>
      {!maximized &&
        HANDLES.map((edge) => (
          <div
            key={edge}
            className={`floating-resize floating-resize-${edge}`}
            onMouseDown={startDrag(edge)}
          />
        ))}
    </div>
  );
}

/** Compute default side-by-side rects for a workbench size. */
export function defaultWorkbenchRects(bounds: { w: number; h: number }): {
  canvas: PanelRect;
  preview: PanelRect;
  inspector: PanelRect;
} {
  const pad = 8;
  const gap = 6;
  const availW = Math.max(600, bounds.w - pad * 2);
  const availH = Math.max(280, bounds.h - pad * 2);
  const canvasW = Math.round(availW * 0.36);
  const previewW = Math.round(availW * 0.38);
  const inspectorW = availW - canvasW - previewW - gap * 2;

  return {
    canvas: { x: pad, y: pad, w: canvasW, h: availH },
    preview: { x: pad + canvasW + gap, y: pad, w: previewW, h: availH },
    inspector: {
      x: pad + canvasW + gap + previewW + gap,
      y: pad,
      w: Math.max(260, inspectorW),
      h: availH,
    },
  };
}
