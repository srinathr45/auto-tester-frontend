import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface PopOutDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  footerActions?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
  size?: 'lg' | 'md' | 'sm' | 'fullscreen';
  /**
   * modal = dimmed blocking overlay.
   * float = fixed window (no overlay) so Preview stays usable during Capture.
   */
  variant?: 'modal' | 'float';
  className?: string;
  /** When false, hide the X and ignore Escape (input-wait Continue must not dismiss). */
  showClose?: boolean;
}

/**
 * Pop-out shell for Preview / Capture. Always portaled to document.body.
 */
export default function PopOutDialog({
  open,
  title,
  onClose,
  footerActions,
  headerActions,
  children,
  size = 'lg',
  variant = 'modal',
  className,
  showClose = true,
}: PopOutDialogProps) {
  const isFloat = variant === 'float';

  useEffect(() => {
    if (!open || !showClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, showClose]);

  if (!open || typeof document === 'undefined') return null;

  const chrome = (
    <>
      <div className="modal-header popout-dialog-header">
        <h2 className="modal-title">{title}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {headerActions}
          {showClose && (
            <button type="button" className="btn-icon" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="popout-dialog-body">{children}</div>
      {footerActions && <div className="popout-dialog-footer">{footerActions}</div>}
    </>
  );

  // Float: no full-screen overlay — just a fixed window (Capture must not cover Preview).
  if (isFloat) {
    return createPortal(
      <div
        className={[
          'popout-float-window',
          `popout-float-${size}`,
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        role="dialog"
        aria-modal="false"
        aria-label={title}
      >
        {chrome}
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="modal-overlay popout-overlay" onMouseDown={onClose}>
      <div
        className={['modal-panel', 'popout-dialog', `popout-dialog-${size}`, className]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {chrome}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  denyLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onDeny: () => void;
  onCancel: () => void;
}

/** Yes / No / Cancel — portaled above the workbench. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Yes',
  denyLabel = 'No',
  cancelLabel = 'Cancel',
  onConfirm,
  onDeny,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="modal-overlay confirm-overlay"
      // mouseDown backdrop only — avoids click-through races with button handlers
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="modal-panel"
        style={{ maxWidth: 400 }}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button type="button" className="btn-icon" onClick={onCancel} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
          {message}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button type="button" className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={onDeny}>
            {denyLabel}
          </button>
          <button type="button" className="btn-primary" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
