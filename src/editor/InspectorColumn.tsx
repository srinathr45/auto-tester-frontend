import { useMemo, useState } from 'react';
import { Trash2, Video } from 'lucide-react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { recordingService } from '../recording/services/recording.service';
import { aiService } from '../ai/services/ai.service';
import { frontendValidatorService } from '../steps/frontendValidator/services/frontend-validator.service';
import { apiValidateService } from '../steps/apiValidate/services/api-validate.service';
import { prepareAiScriptHtml } from '../steps/aiScript/services/ai-script.service';
import { isRepeatEdge } from '../shared/loopGraph';
import { orderFlowNodes } from '../shared/orderNodes';
import { resolveStepKind } from '../shared/stepKinds';
import type { Flow, FlowEdge, FlowNode, Project, Result, StepData } from '../shared/types';
import RunPanel from './RunPanel';
import RecordingPanel from './RecordingPanel';
import StepKindFields, { isGenerateStepKind } from '../steps/StepKindFields';

interface InspectorColumnProps {
  selectedNode: FlowNode | null;
  selectedFlow: Flow | null;
  selectedProject: Project | null;
  nodes: FlowNode[];
  edges: FlowEdge[];
  onUpdateNode: (nodeId: string, data: Partial<StepData>) => void;
  onDeleteNode: (nodeId: string) => void;
  /** Set or clear the Loop → body-start Repeat edge. */
  onSetRepeatFrom: (loopNodeId: string, targetNodeId: string | null) => void;
  activeResultId: number | null;
  onCloseRunPanel: () => void;
  onRunProgress: (result: Result) => void;
  maximized?: boolean;
  /** Ask popup vs docked (parent-owned). */
  onOpenCapture?: () => void;
  /** Capture docked in the inspector output pane. */
  captureDocked?: boolean;
  onCloseCapture?: () => void;
  onPopOutCapture?: () => void;
  onInsertCaptureScript?: (lines: string) => void;
  /** Show/focus Preview without opening action Capture. */
  onEnsurePreview?: () => void;
  /** Hide the built-in title bar when parent FloatingPanel provides chrome. */
  hideHeader?: boolean;
}

/**
 * Step properties, script editor, and docked run/capture output.
 * Capture asks popup vs docked in FlowEditor, then lands here when docked.
 */
export default function InspectorColumn({
  selectedNode,
  selectedFlow,
  selectedProject,
  nodes,
  edges,
  onUpdateNode,
  onDeleteNode,
  onSetRepeatFrom,
  activeResultId,
  onCloseRunPanel,
  onRunProgress,
  maximized = false,
  onOpenCapture,
  captureDocked = false,
  onCloseCapture,
  onPopOutCapture,
  onInsertCaptureScript,
  onEnsurePreview,
  hideHeader = false,
}: InspectorColumnProps) {
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [capturingHtml, setCapturingHtml] = useState(false);
  const [htmlCaptureError, setHtmlCaptureError] = useState<string | null>(null);
  const [htmlCaptureSession, setHtmlCaptureSession] = useState<{
    nodeId: string;
    sessionId: string;
  } | null>(null);
  const showOutput = Boolean(captureDocked || activeResultId);
  const selectedKind = selectedNode ? resolveStepKind(selectedNode.data) : null;
  const isLoopStep = selectedKind === 'loop';

  const orderedSteps = useMemo(() => orderFlowNodes(nodes, edges), [nodes, edges]);

  const repeatFromId = useMemo(() => {
    if (!selectedNode || !isLoopStep) return null;
    const edge = edges.find((e) => e.source === selectedNode.id && isRepeatEdge(e));
    return edge?.target ?? null;
  }, [selectedNode, isLoopStep, edges]);

  const repeatFromOptions = useMemo(() => {
    if (!selectedNode || !isLoopStep) return [];
    return orderedSteps
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => node.id !== selectedNode.id)
      .map(({ node, index }) => ({
        id: node.id,
        label: `${index + 1}. ${node.data.label || 'Step'}`,
      }));
  }, [selectedNode, isLoopStep, orderedSteps]);

  const layoutNoOutput = useDefaultLayout({
    id: 'inspector',
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });
  const layoutWithOutput = useDefaultLayout({
    id: 'inspector-output',
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });

  /**
   * Ask Nest to author Playwright for this create-time kind.
   * AI script locates a small HTML slice from the live page, then generates.
   */
  const handleGenerate = async () => {
    if (!selectedNode) return;
    const kind = resolveStepKind(selectedNode.data);
    if (!isGenerateStepKind(kind)) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      if (kind === 'aiScript') {
        const goal = String(selectedNode.data.goal || '').trim();
        if (!goal) {
          throw new Error('Write a goal describing what this step should do.');
        }
        const sessionId =
          htmlCaptureSession?.nodeId === selectedNode.id ? htmlCaptureSession.sessionId : null;
        const prepared = await prepareAiScriptHtml({
          goal,
          sessionId,
          recapture: recaptureHtmlPage,
        });
        if (prepared.sessionId !== sessionId) {
          setHtmlCaptureSession({ nodeId: selectedNode.id, sessionId: prepared.sessionId });
        }
        const result = await aiService.generateScript({
          stepKind: kind,
          goal,
          htmlElements: prepared.htmlElements,
        });
        onUpdateNode(selectedNode.id, {
          scriptText: result.scriptText,
          htmlElements: prepared.htmlElements,
          ...(prepared.catalog ? { htmlCatalog: prepared.catalog } : {}),
        });
        return;
      }

      let snapshot = '';
      try {
        const snap = await window.autoTester?.getPageSnapshot?.();
        snapshot = snap?.snapshot || '';
      } catch {
        snapshot = '';
      }
      if (kind === 'patternValidate' && selectedNode.data.frontendValidator?.fields?.length) {
        const validator = selectedNode.data.frontendValidator;
        const aiFields = validator.fields.filter((item) => item.scriptMode !== 'manual');
        if (aiFields.length && aiFields.some((item) => !item.rule.trim())) {
          throw new Error('Add a prompt for every AI field before generating.');
        }
        if (!aiFields.length && !validator.fields.some((item) => item.scriptText?.trim())) {
          throw new Error('Add at least one AI field with a prompt or a manual script before generating.');
        }
        let nextFields = validator.fields;
        if (aiFields.length) {
          const result = await frontendValidatorService.generate(
            validator.fields,
            snapshot,
            validator.triggerButton,
          );
          nextFields = frontendValidatorService.applyGenerationResults(
            validator.fields,
            result.plans,
            validator.triggerButton,
          );
        }
        const refreshed = frontendValidatorService.refreshScripts({
          ...validator,
          fields: nextFields,
        });
        onUpdateNode(selectedNode.id, {
          scriptText: refreshed.scriptText,
          frontendValidator: refreshed.config,
        });
        return;
      }
      if (kind === 'apiValidate' && selectedNode.data.apiValidate?.apis?.length) {
        const apiValidate = selectedNode.data.apiValidate;
        const aiApis = (apiValidate.apis || []).filter((item) => item.scriptMode !== 'manual');
        if (aiApis.length && aiApis.some((item) => !item.rule.trim())) {
          throw new Error('Add a prompt for every AI API before generating.');
        }
        if (!aiApis.length && !(apiValidate.apis || []).some((item) => item.scriptText?.trim())) {
          throw new Error('Add at least one AI API with a prompt or a manual script before generating.');
        }
        let nextApis = apiValidate.apis || [];
        if (aiApis.length) {
          const result = await apiValidateService.generate(apiValidate.apis);
          nextApis = apiValidateService.applyGenerationResults(
            apiValidate.apis,
            result.scripts,
          );
        }
        const refreshed = apiValidateService.refreshScripts({
          ...apiValidate,
          apis: nextApis,
        });
        onUpdateNode(selectedNode.id, {
          scriptText: refreshed.scriptText,
          apiValidate: refreshed.config,
        });
        return;
      }
      const result = await aiService.generateScript({
        stepKind: kind,
        goal: selectedNode.data.goal,
        snapshot: snapshot || undefined,
        wait: selectedNode.data.wait,
        pattern: selectedNode.data.pattern,
        api: selectedNode.data.api,
      });
      onUpdateNode(selectedNode.id, { scriptText: result.scriptText });
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Warm up prior steps, attach Preview, and index interactive controls.
   * Generate later sends only the matching section, not the full page.
   */
  const recaptureHtmlPage = async () => {
    if (!selectedNode) throw new Error('No step selected');
    if (!selectedProject) throw new Error('No project selected');
    onEnsurePreview?.();
    const res = await recordingService.captureHtml({
      untilNodeId: selectedNode.id,
      url: selectedProject.url,
      projectUrl: selectedProject.url,
      nodes,
      edges,
    });
    setHtmlCaptureSession({ nodeId: selectedNode.id, sessionId: res.sessionId });
    onUpdateNode(selectedNode.id, { htmlCatalog: res.catalog, htmlElements: '' });
    return { sessionId: res.sessionId, catalog: res.catalog };
  };

  const handleCaptureHtml = async () => {
    if (!selectedNode) return;
    setCapturingHtml(true);
    setHtmlCaptureError(null);
    setGenerateError(null);
    try {
      await recaptureHtmlPage();
    } catch (err) {
      setHtmlCaptureError(err instanceof Error ? err.message : 'HTML capture failed');
    } finally {
      setCapturingHtml(false);
    }
  };

  const title =
    maximized && selectedNode
      ? isLoopStep
        ? 'Navigate back'
        : 'Script'
      : selectedNode
        ? 'Step'
        : 'Inspector';
  const scriptLabel = isLoopStep ? 'Navigate back (JS)' : 'Playwright script (JS)';
  const scriptPlaceholder = isLoopStep
    ? `await page.goto('/the-page-to-repeat');\n`
    : `await page.click('#login-button');\nawait expect(page.locator('.title')).toBeVisible();`;
  const scriptHint = isLoopStep
    ? 'Runs before each repeat, not the first pass. Capture in Preview or paste Playwright JS (page, expect).'
    : selectedKind === 'aiFill'
      ? 'Generate the Auto Form Filler script from the fields above. Later runs use the saved script.'
      : selectedKind === 'patternValidate'
        ? 'Generate the Frontend Validator script from the selected fields and rules.'
        : selectedKind === 'apiValidate'
          ? 'Generate the API check script from the selected APIs and rules.'
      : maximized
        ? 'APIs: page, expect. Generate with AI or Capture in Preview. Esc restores the layout.'
        : 'APIs: page, expect. Generate with AI or Capture in Preview.';

  const headerActions = selectedNode && (
    <div style={{ display: 'flex', gap: 6 }}>
      {onOpenCapture &&
        selectedKind !== 'aiFill' &&
        selectedKind !== 'patternValidate' &&
        selectedKind !== 'apiValidate' && (
        <button
          type="button"
          className="btn-secondary"
          style={{ padding: '0.25rem 0.45rem', fontSize: '0.7rem' }}
          onClick={(e) => {
            e.stopPropagation();
            onOpenCapture();
          }}
          title={isLoopStep ? 'Capture navigate-back actions into this loop' : 'Capture actions into this step'}
        >
          <Video size={12} />
          Capture
        </button>
      )}
      {!maximized && (
        <button
          type="button"
          className="btn-danger"
          style={{ padding: '0.25rem 0.45rem' }}
          onClick={() => onDeleteNode(selectedNode.id)}
          title="Delete step"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );

  return (
    <div className="editor-col">
      {!hideHeader && (
        <div className="editor-col-header">
          <span>{title}</span>
          {headerActions}
        </div>
      )}

      {hideHeader && headerActions && (
        <div className="editor-col-header inspector-float-actions">
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {selectedNode?.data.label || 'Step'}
          </span>
          {headerActions}
        </div>
      )}

      {!selectedNode && (
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {selectedFlow ? (
            <>
              <div>
                <div
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-muted)',
                    marginBottom: 6,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  Flow
                </div>
                <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{selectedFlow.name}</div>
                {selectedFlow.description && (
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
                    {selectedFlow.description}
                  </p>
                )}
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>
                Select a step on the canvas to edit its Playwright script. Use Capture to record
                clicks and typing in the Preview panel.
              </p>
            </>
          ) : (
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>No flow selected.</p>
          )}
        </div>
      )}

      {selectedNode && maximized && (
        <div className="inspector-section" style={{ padding: 12, gap: 6, flex: 1 }}>
          <label className="field-label">{scriptLabel}</label>
          <textarea
            className="textarea inspector-script"
            value={selectedNode.data.scriptText || ''}
            onChange={(e) => onUpdateNode(selectedNode.id, { scriptText: e.target.value })}
            placeholder={scriptPlaceholder}
          />
          <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', flexShrink: 0 }}>
            {scriptHint}
          </div>
        </div>
      )}

      {selectedNode && !maximized && (
        <Group
          key={showOutput ? 'with-output' : 'no-output'}
          id={showOutput ? 'inspector-output' : 'inspector'}
          className="inspector-body"
          orientation="vertical"
          defaultLayout={
            showOutput
              ? (layoutWithOutput.defaultLayout ?? { props: 22, script: 50, output: 28 })
              : (layoutNoOutput.defaultLayout ?? { props: 24, script: 76 })
          }
          onLayoutChanged={showOutput ? layoutWithOutput.onLayoutChanged : layoutNoOutput.onLayoutChanged}
        >
          <Panel
            id="props"
            defaultSize="24%"
            minSize="12%"
            maxSize="50%"
            collapsible
            collapsedSize="0%"
          >
            <div className="inspector-section" style={{ padding: 12, gap: 12, overflowY: 'auto' }}>
              <div>
                <label className="field-label">Step name</label>
                <input
                  className="input"
                  value={selectedNode.data.label || ''}
                  onChange={(e) => onUpdateNode(selectedNode.id, { label: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label">Description</label>
                <input
                  className="input"
                  value={selectedNode.data.description || ''}
                  onChange={(e) => onUpdateNode(selectedNode.id, { description: e.target.value })}
                  placeholder={
                    resolveStepKind(selectedNode.data) === 'inputWait'
                      ? 'e.g. Enter the SMS OTP'
                      : 'What this step does'
                  }
                />
              </div>
              <StepKindFields
                data={selectedNode.data}
                generating={generating}
                generateError={generateError}
                onChange={(patch) => {
                  setGenerateError(null);
                  onUpdateNode(selectedNode.id, patch);
                }}
                onGenerate={() => void handleGenerate()}
                capturingHtml={capturingHtml}
                htmlCaptureError={htmlCaptureError}
                onCaptureHtml={() => void handleCaptureHtml()}
                aiFillContext={
                  selectedKind === 'aiFill' && selectedNode
                    ? {
                        project: selectedProject,
                        nodes,
                        edges,
                        selectedNodeId: selectedNode.id,
                        onEnsurePreview,
                      }
                    : undefined
                }
                fieldCaptureContext={
                  (selectedKind === 'patternValidate' || selectedKind === 'apiValidate') &&
                  selectedNode
                    ? {
                        project: selectedProject,
                        nodes,
                        edges,
                        selectedNodeId: selectedNode.id,
                        onEnsurePreview,
                      }
                    : undefined
                }
                repeatFromOptions={repeatFromOptions}
                repeatFromId={repeatFromId}
                onRepeatFromChange={(targetId) =>
                  onSetRepeatFrom(selectedNode.id, targetId)
                }
              />
            </div>
          </Panel>

          <Separator className="editor-split-h" />

          <Panel id="script" defaultSize={showOutput ? '50%' : '76%'} minSize="20%">
            <div className="inspector-section" style={{ padding: 12, gap: 6 }}>
              <label className="field-label">{scriptLabel}</label>
              <textarea
                className="textarea inspector-script"
                value={selectedNode.data.scriptText || ''}
                onChange={(e) => onUpdateNode(selectedNode.id, { scriptText: e.target.value })}
                placeholder={scriptPlaceholder}
              />
              <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', flexShrink: 0 }}>
                {scriptHint}
              </div>
            </div>
          </Panel>

          {showOutput && (
            <>
              <Separator className="editor-split-h" />
              <Panel id="output" defaultSize="28%" minSize="12%" collapsible collapsedSize="0%">
                <div className="inspector-section">
                  {captureDocked && selectedNode && onCloseCapture && onInsertCaptureScript && (
                    <RecordingPanel
                      project={selectedProject}
                      flow={selectedFlow}
                      nodes={nodes}
                      edges={edges}
                      selectedNode={selectedNode}
                      onInsertScript={onInsertCaptureScript}
                      onClose={onCloseCapture}
                      onPopOut={onPopOutCapture}
                      embedded
                    />
                  )}
                  {!captureDocked && activeResultId && (
                    <RunPanel
                      resultId={activeResultId}
                      onClose={onCloseRunPanel}
                      onProgress={onRunProgress}
                      embedded
                    />
                  )}
                </div>
              </Panel>
            </>
          )}
        </Group>
      )}
    </div>
  );
}
