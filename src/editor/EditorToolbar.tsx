import { useEffect, useRef, useState } from 'react';
import {
  Play,
  Save,
  Gauge,
  ArrowLeft,
  Undo2,
  Redo2,
  Plus,
  LayoutDashboard,
  Video,
  BookOpen,
  PanelsTopLeft,
  Check,
  GitBranch,
} from 'lucide-react';
import type { Flow, Project } from '../shared/types';
import ThemeToggle from '../theme/ThemeToggle';
import type { WorkbenchPanelId, WorkbenchPanelVisibility } from './FlowEditor';

interface EditorToolbarProps {
  selectedProject: Project | null;
  flows: Flow[];
  selectedFlow: Flow | null;
  onSelectFlow: (flow: Flow) => void;
  onOpenFlowModal: () => void;
  onSaveFlow: () => void;
  onRunFlow: () => void;
  onOpenManual: () => void;
  onBackToProjects: () => void;
  onBackToDashboard: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  lineDelayMs: number;
  onLineDelayChange: (ms: number) => void;
  recordVideo: boolean;
  onToggleRecordVideo: () => void;
  isExecuting: boolean;
  desktopReady: boolean;
  panelVisibility: WorkbenchPanelVisibility;
  onTogglePanel: (panel: WorkbenchPanelId) => void;
  onOpenVersionControl: () => void;
}

const VIEW_ITEMS: { id: WorkbenchPanelId; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'preview', label: 'Preview' },
  { id: 'inspector', label: 'Inspector' },
];

export default function EditorToolbar({
  selectedProject,
  flows,
  selectedFlow,
  onSelectFlow,
  onOpenFlowModal,
  onSaveFlow,
  onRunFlow,
  onOpenManual,
  onBackToProjects,
  onBackToDashboard,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  lineDelayMs,
  onLineDelayChange,
  recordVideo,
  onToggleRecordVideo,
  isExecuting,
  desktopReady,
  panelVisibility,
  onTogglePanel,
  onOpenVersionControl,
}: EditorToolbarProps) {
  const [viewOpen, setViewOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!viewOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (viewRef.current?.contains(event.target as Node)) return;
      setViewOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setViewOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [viewOpen]);

  return (
    <header
      style={{
        height: 'var(--toolbar-h)',
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-panel)',
        position: 'relative',
        zIndex: 200,
        flexShrink: 0,
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <button className="btn-secondary" style={{ padding: '0.3rem 0.55rem' }} onClick={onBackToProjects}>
          <ArrowLeft size={14} />
          <span>Projects</span>
        </button>
        <button className="btn-secondary" style={{ padding: '0.3rem 0.55rem' }} onClick={onBackToDashboard}>
          <LayoutDashboard size={14} />
          <span>Flows</span>
        </button>

        <div className="toolbar-divider" />

        <div
          style={{
            fontWeight: 600,
            fontSize: '0.75rem',
            maxWidth: 110,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text-muted)',
          }}
          title={selectedProject?.name || 'Project'}
        >
          {selectedProject?.name || 'Project'}
        </div>

        <select
          className="select"
          style={{ width: 170 }}
          value={selectedFlow?.id || ''}
          onChange={(e) => {
            const flow = flows.find((f) => f.id === Number(e.target.value));
            if (flow) onSelectFlow(flow);
          }}
        >
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <button className="btn-icon" onClick={onOpenFlowModal} title="New flow" aria-label="New flow">
          <Plus size={14} />
        </button>

        <div className="toolbar-divider" />

        <div ref={viewRef} className="toolbar-view-menu">
          <button
            type="button"
            className={`btn-secondary${viewOpen ? ' is-active' : ''}`}
            style={{ padding: '0.3rem 0.65rem' }}
            onClick={() => setViewOpen((open) => !open)}
            title="Show or hide workbench panels"
            aria-haspopup="menu"
            aria-expanded={viewOpen}
          >
            <PanelsTopLeft size={14} />
            <span>View</span>
          </button>
          {viewOpen && (
            <div className="toolbar-view-dropdown" role="menu">
              <div className="toolbar-view-dropdown-title">Panels</div>
              {VIEW_ITEMS.map((item) => {
                const on = panelVisibility[item.id];
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    className={`toolbar-view-item${on ? ' is-on' : ''}`}
                    onClick={() => onTogglePanel(item.id)}
                  >
                    <span className="toolbar-view-check" aria-hidden>
                      {on ? <Check size={12} /> : null}
                    </span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div
          className={`status-pill ${desktopReady ? 'is-ok' : 'is-bad'}`}
          title={
            desktopReady
              ? 'Electron desktop runtime ready'
              : 'Open with Electron (npm run desktop:dev) for Run/Capture'
          }
        >
          {desktopReady ? 'Desktop' : 'No Desktop'}
        </div>

        <ThemeToggle compact />

        <button className="btn-icon" onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo">
          <Undo2 size={14} />
        </button>
        <button className="btn-icon" onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo">
          <Redo2 size={14} />
        </button>

        <button className="btn-secondary" onClick={onOpenVersionControl} title="Open version control">
          <GitBranch size={14} />
          <span>Version control</span>
        </button>

        <button className="btn-secondary" onClick={onSaveFlow} style={{ padding: '0.3rem 0.65rem' }}>
          <Save size={14} />
          <span>Save</span>
        </button>

        <button
          className="btn-secondary"
          onClick={onOpenManual}
          title="Create / edit manual from flow steps"
          style={{ padding: '0.3rem 0.65rem' }}
        >
          <BookOpen size={14} />
          <span>Manual</span>
        </button>

        <div
          className={`pace-control${lineDelayMs > 0 ? ' is-active' : ''}`}
          title="Pause before each script line (0–1000 ms) so Preview is easier to follow"
        >
          <Gauge size={14} aria-hidden />
          <input
            type="range"
            className="pace-control-slider"
            min={0}
            max={1000}
            step={50}
            value={lineDelayMs}
            onChange={(e) => onLineDelayChange(Number(e.target.value))}
            aria-label="Line execution delay"
            aria-valuemin={0}
            aria-valuemax={1000}
            aria-valuenow={lineDelayMs}
          />
          <span className="pace-control-value">{lineDelayMs === 0 ? 'Off' : `${lineDelayMs}ms`}</span>
        </div>

        <button
          className={`btn-secondary${recordVideo ? ' is-active' : ''}`}
          onClick={onToggleRecordVideo}
          title="Record a video of the run, then pick where to save it"
          style={{ padding: '0.3rem 0.65rem' }}
        >
          <Video size={14} />
          <span>{recordVideo ? 'Recording' : 'Record'}</span>
        </button>

        <button
          className="btn-primary"
          onClick={onRunFlow}
          disabled={isExecuting || !desktopReady}
          style={{ padding: '0.3rem 0.75rem' }}
        >
          <Play size={14} fill="currentColor" />
          <span>{isExecuting ? 'Running…' : 'Run'}</span>
        </button>
      </div>
    </header>
  );
}
