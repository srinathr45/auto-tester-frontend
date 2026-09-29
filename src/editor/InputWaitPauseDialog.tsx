import { useEffect, useState } from 'react';
import { resultService } from '../results/services/result.service';
import PopOutDialog from './PopOutDialog';

interface InputWaitPauseDialogProps {
  resultId: number | null;
}

/** Strip the body sentence so the title is "Paused for {description}". */
function pauseTitle(message: string): string {
  return (
    message.replace(/\.\s*Please complete this and press Continue\.?\s*$/i, '').trim() ||
    message
  );
}

/**
 * Float prompt while the runner is paused for OTP/captcha.
 * Mounted on the workbench (not Run panel) so it still appears if Inspector is hidden.
 */
export default function InputWaitPauseDialog({ resultId }: InputWaitPauseDialogProps) {
  const [pauseMessage, setPauseMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!resultId) {
      setPauseMessage(null);
      return;
    }
    let mounted = true;
    const tick = async () => {
      try {
        const data = await resultService.getLiveRun(resultId);
        if (!mounted) return;
        const show = data.result === 'paused' && Boolean(data.pauseMessage);
        setPauseMessage(show ? data.pauseMessage || null : null);
      } catch {
        if (mounted) setPauseMessage(null);
      }
    };
    void tick();
    const interval = setInterval(() => void tick(), 1000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [resultId]);

  const handleContinue = async () => {
    if (!resultId) return;
    setBusy(true);
    try {
      await resultService.resume(resultId);
      setPauseMessage(null);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PopOutDialog
      open={Boolean(pauseMessage)}
      title={pauseMessage ? pauseTitle(pauseMessage) : 'Paused'}
      onClose={() => undefined}
      showClose={false}
      size="sm"
      variant="float"
      className="input-wait-pause-dialog"
      footerActions={
        <button
          type="button"
          className="btn-primary"
          onClick={() => void handleContinue()}
          disabled={busy}
        >
          Continue
        </button>
      }
    >
      <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5, margin: 0 }}>
        Please complete this and press Continue.
      </p>
    </PopOutDialog>
  );
}
