import { useState } from 'react';
import PopOutDialog from '../editor/PopOutDialog';
import type { FlowBranch, FlowCommit } from '../shared/types';

interface VersionControlWindowProps {
  open: boolean;
  currentBranch: string;
  branches: FlowBranch[];
  commits: FlowCommit[];
  onClose: () => void;
  onChangeBranch: (branch: string) => void;
  onCreateBranch: (name: string) => void;
  onSync: (message: string) => void;
  onPull: () => void;
  onMerge: (sourceBranch: string) => void;
  onRevert: (commitId: string) => void;
}

/** Dedicated version-control window so branch operations do not crowd the editor. */
export default function VersionControlWindow({
  open,
  currentBranch,
  branches,
  commits,
  onClose,
  onChangeBranch,
  onCreateBranch,
  onSync,
  onPull,
  onMerge,
  onRevert,
}: VersionControlWindowProps) {
  const [promptKind, setPromptKind] = useState<'branch' | 'sync' | 'merge' | null>(null);
  const [promptValue, setPromptValue] = useState('');

  const openPrompt = (kind: 'branch' | 'sync' | 'merge') => {
    const defaultBranch =
      branches.find((branch) => branch.name !== currentBranch)?.name || '';
    setPromptKind(kind);
    setPromptValue(kind === 'merge' ? defaultBranch : '');
  };

  const submitPrompt = () => {
    const value = promptValue.trim();
    if (!value || !promptKind) return;
    if (promptKind === 'branch') onCreateBranch(value);
    if (promptKind === 'sync') onSync(value);
    if (promptKind === 'merge') onMerge(value);
    setPromptKind(null);
    setPromptValue('');
  };

  return (
    <PopOutDialog
      open={open}
      title="Version control"
      onClose={onClose}
      size="lg"
      variant="float"
      className="version-control-window"
    >
      <div style={{ display: 'grid', gap: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            paddingBottom: 12,
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <label htmlFor="version-branch" style={{ fontWeight: 600 }}>
            Branch
          </label>
          <select
            id="version-branch"
            className="select"
            value={currentBranch}
            onChange={(event) => onChangeBranch(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.name}>
                {branch.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary" onClick={() => openPrompt('branch')}>
            New branch
          </button>
          <button type="button" className="btn-secondary" onClick={() => openPrompt('sync')}>
            Sync
          </button>
          <button type="button" className="btn-secondary" onClick={onPull}>
            Pull
          </button>
          <button type="button" className="btn-secondary" onClick={() => openPrompt('merge')}>
            Merge
          </button>
        </div>

        {promptKind && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: 12,
              border: '1px solid var(--border-color)',
              borderRadius: 8,
            }}
          >
            <label htmlFor="version-action-input" style={{ fontWeight: 600 }}>
              {promptKind === 'branch'
                ? 'New branch name'
                : promptKind === 'sync'
                  ? 'Commit message'
                  : 'Source branch'}
            </label>
            <input
              id="version-action-input"
              className="input"
              autoFocus
              value={promptValue}
              onChange={(event) => setPromptValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitPrompt();
                if (event.key === 'Escape') setPromptKind(null);
              }}
            />
            <button type="button" className="btn-primary" onClick={submitPrompt}>
              Continue
            </button>
            <button type="button" className="btn-secondary" onClick={() => setPromptKind(null)}>
              Cancel
            </button>
          </div>
        )}

        <div style={{ minHeight: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 10,
            }}
          >
            <h3 style={{ margin: 0 }}>Commit history</h3>
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {commits.length} commit{commits.length === 1 ? '' : 's'}
            </span>
          </div>
          {commits.length === 0 ? (
            <p className="muted">No commits on this branch yet.</p>
          ) : (
            <div className="version-history-scroll">
              <div className="version-history-timeline">
                {commits.map((commit, index) => (
                  <div className="version-history-item" key={commit.id}>
                    <div className="version-history-rail" aria-hidden>
                      <span className="version-history-dot" />
                    </div>
                    <div className="version-history-card">
                      <div className="version-history-card-header">
                        <div style={{ minWidth: 0 }}>
                          <div className="version-history-message">{commit.message}</div>
                          <div className="muted" style={{ fontSize: '0.75rem' }}>
                            {new Date(commit.createdAt).toLocaleString()} · {commit.id.slice(0, 10)}
                          </div>
                        </div>
                        <span className="version-history-index">#{commits.length - index}</span>
                      </div>
                      <div className="version-history-card-footer">
                        <span className="version-history-badge">
                          {commit.parentIds.length > 1 ? 'Merge commit' : currentBranch}
                        </span>
                        <button type="button" className="btn-secondary" onClick={() => onRevert(commit.id)}>
                          Revert
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </PopOutDialog>
  );
}
