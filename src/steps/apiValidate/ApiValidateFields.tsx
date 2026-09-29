import { useEffect, useState } from 'react';
import { Check, Crosshair, Sparkles } from 'lucide-react';
import { recordingService } from '../../recording/services/recording.service';
import type { ApiValidateConfig, ApiValidateItem, CapturedApiCall } from '../../shared/types';
import {
  apiAlias,
  refreshApiValidateScripts,
  rematchSelectedApis,
} from './services/api-validate.compile';
import { apiValidateService } from './services/api-validate.service';
import type { KindFieldsProps } from '../types';

function configFor(data: KindFieldsProps['data']): ApiValidateConfig {
  return data.apiValidate || { capturedApis: [], apis: [] };
}

function callKey(call: CapturedApiCall): string {
  return call.id;
}

function formatCall(call: CapturedApiCall): string {
  const occurrence = call.occurrence && call.occurrence > 1 ? ` #${call.occurrence}` : '';
  return `${call.method} ${call.urlPattern}${occurrence} (${call.status})`;
}

export default function ApiValidateFields({
  data,
  onChange,
  fieldCaptureContext,
}: KindFieldsProps) {
  const context = fieldCaptureContext;
  const config = configFor(data);
  const capturedApis = config.capturedApis || [];
  const selectedApis = config.apis || [];
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (sessionId) void recordingService.stop(sessionId).catch(() => undefined);
    };
  }, [sessionId]);

  const updateConfig = (patch: Partial<ApiValidateConfig>) => {
    const nextConfig = { ...config, ...patch };
    const refreshed = refreshApiValidateScripts(nextConfig);
    onChange({
      apiValidate: refreshed.config,
      scriptText: refreshed.scriptText,
    });
  };

  const updateApis = (apis: ApiValidateItem[]) => {
    updateConfig({ apis });
  };

  const toggleApi = (call: CapturedApiCall) => {
    const exists = selectedApis.some((item) => callKey(item.api) === callKey(call));
    if (exists) {
      updateApis(selectedApis.filter((item) => callKey(item.api) !== callKey(call)));
      return;
    }
    updateApis([...selectedApis, { api: call, alias: '', rule: '', scriptMode: 'ai' }]);
  };

  const updateRule = (alias: string, rule: string) => {
    updateApis(selectedApis.map((item) => (item.alias === alias ? { ...item, rule } : item)));
  };

  const updateScript = (alias: string, scriptText: string) => {
    updateApis(
      selectedApis.map((item) => (item.alias === alias ? { ...item, scriptText } : item)),
    );
  };

  const setScriptMode = (alias: string, scriptMode: 'ai' | 'manual') => {
    updateApis(
      selectedApis.map((item) => (item.alias === alias ? { ...item, scriptMode } : item)),
    );
  };

  const clearScript = (alias: string) => {
    updateApis(
      selectedApis.map((item) =>
        item.alias === alias ? { ...item, scriptText: '' } : item,
      ),
    );
  };

  const captureApis = async () => {
    if (!context?.project) {
      setError('Select a project before capturing.');
      return;
    }
    setBusy(true);
    setError(null);
    setCaptureMessage(null);
    try {
      if (sessionId) {
        await recordingService.stop(sessionId).catch(() => undefined);
        setSessionId(null);
      }
      context.onEnsurePreview?.();
      const result = await recordingService.captureApis({
        untilNodeId: context.selectedNodeId,
        url: context.project.url,
        projectUrl: context.project.url,
        nodes: context.nodes,
        edges: context.edges,
      });
      if (!result) throw new Error('Desktop runtime unavailable.');
      setSessionId(result.sessionId);
      const rematched = rematchSelectedApis(result.apis, selectedApis);
      updateConfig({
        capturedApis: result.apis,
        apis: rematched,
      });
      setCaptureMessage(
        `Captured ${result.apis.length} API(s) from "${result.previousStepLabel}".`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not capture APIs');
    } finally {
      setBusy(false);
    }
  };

  const generateApiScript = async (alias: string) => {
    const item = selectedApis.find((entry) => entry.alias === alias);
    if (!item || item.scriptMode === 'manual') return;
    if (!item.rule.trim()) {
      setError('Add a prompt before generating this API script.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await apiValidateService.generate(selectedApis, alias);
      const nextApis = apiValidateService.applyGenerationResults(selectedApis, result.scripts);
      updateApis(nextApis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate API script');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => void captureApis()}
        disabled={busy}
      >
        <Crosshair size={12} />
        {busy ? 'Capturing…' : 'Capture APIs'}
      </button>
      <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: 6, lineHeight: 1.45 }}>
        Runs prior steps, then records xhr/fetch calls from the previous step only.
      </div>
      {captureMessage && (
        <div style={{ fontSize: '0.68rem', color: 'var(--accent-green)', marginTop: 4 }}>
          {captureMessage}
        </div>
      )}

      {capturedApis.length > 0 && (
        <div>
          <label className="field-label">APIs to validate</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {capturedApis.map((call) => {
              const selected = selectedApis.some(
                (item) => callKey(item.api) === callKey(call),
              );
              return (
                <label
                  key={callKey(call)}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem' }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleApi(call)}
                  />
                  {formatCall(call)}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {selectedApis.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">API validation</label>
          {selectedApis.map((item, index) => {
            const alias = item.alias || apiAlias(index);
            const scriptMode = item.scriptMode ?? 'ai';
            return (
              <div
                key={callKey(item.api)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  padding: '8px 10px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>
                    {alias}: {formatCall(item.api)}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      type="button"
                      className={scriptMode === 'manual' ? 'btn-primary' : 'btn-secondary'}
                      style={{ fontSize: '0.62rem', padding: '2px 8px' }}
                      onClick={() => setScriptMode(alias, 'manual')}
                    >
                      Manual
                    </button>
                    <button
                      type="button"
                      className={scriptMode === 'ai' ? 'btn-primary' : 'btn-secondary'}
                      style={{ fontSize: '0.62rem', padding: '2px 8px' }}
                      onClick={() => setScriptMode(alias, 'ai')}
                    >
                      AI
                    </button>
                  </div>
                </div>
                {scriptMode === 'ai' && (
                  <textarea
                    className="textarea"
                    rows={2}
                    value={item.rule}
                    onChange={(event) => updateRule(alias, event.target.value)}
                    placeholder="Prompt: e.g. status 200; body.id matches api1.response.body.id"
                  />
                )}
                <textarea
                  className="textarea"
                  rows={5}
                  value={item.scriptText || ''}
                  onChange={(event) => updateScript(alias, event.target.value)}
                  placeholder={
                    scriptMode === 'manual'
                      ? `Playwright JS for ${alias}. Bindings: ${selectedApis.map((_, i) => apiAlias(i)).join(', ')}, expect, warn.`
                      : 'Generated script appears here. You can edit it after generation.'
                  }
                  style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: '0.68rem' }}
                />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {scriptMode === 'ai' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => void generateApiScript(alias)}
                      disabled={busy || !item.rule.trim()}
                    >
                      <Sparkles size={12} /> Generate script
                    </button>
                  )}
                  {item.scriptText?.trim() && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => clearScript(alias)}
                    >
                      Clear script
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {capturedApis.length === 0 && (
        <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', lineHeight: 1.45 }}>
          Capture APIs from the previous step, then select the calls to assert.
        </div>
      )}
      {selectedApis.some(
        (item) => item.scriptMode === 'manual' && !item.scriptText?.trim(),
      ) && (
        <div style={{ fontSize: '0.68rem', color: 'var(--warn-text)', lineHeight: 1.45 }}>
          Manual APIs need a script before the step can run.
        </div>
      )}
      {selectedApis.some(
        (item) => (item.scriptMode ?? 'ai') === 'ai' && !item.rule.trim(),
      ) && (
        <div style={{ fontSize: '0.68rem', color: 'var(--warn-text)', lineHeight: 1.45 }}>
          AI APIs need a prompt before generating scripts.
        </div>
      )}
      {error && <div style={{ fontSize: '0.7rem', color: 'var(--danger-text)' }}>{error}</div>}
      {selectedApis.some(
        (item) => (item.scriptMode ?? 'ai') === 'ai' && item.rule.trim(),
      ) && (
        <div style={{ fontSize: '0.68rem', color: 'var(--accent-green)', lineHeight: 1.45 }}>
          <Check size={11} style={{ verticalAlign: 'middle' }} /> AI APIs ready for generation.
          Manual scripts are preserved during bulk generate.
        </div>
      )}
    </>
  );
}
