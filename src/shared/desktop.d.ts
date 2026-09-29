import type { AiFillField, CapturedApiCall, FlowCommit, FlowGraph, HtmlCatalogItem, HtmlLocateHint } from './types';

export type AutoTesterApi = {
  health: () => Promise<{ ok: boolean; service: string }>;
  getApiBackendUrl?: () => Promise<string>;
  setApiBackendUrl?: (url: string) => Promise<string>;
  setAuthToken?: (token: string | null) => Promise<{ ok: boolean }>;
  startRun: (body: {
    resultId: number;
    flowId: number;
    projectId: number;
    projectUrl?: string;
    projectName?: string;
    flowName?: string;
    commitId?: string | null;
    lineDelayMs?: number;
    recordVideo?: boolean;
    manualCapture?: {
      manualId: number;
      stepMap: Record<string, number>;
    };
    nodes: unknown[];
    edges: unknown[];
  }) => Promise<{
    id: number;
    resultId: number;
    flowId: number;
    projectId: number;
    result: string;
    stepProgress: unknown;
    currentNodeId: string | null;
    failedStepId: number | null;
    errorMessage: string | null;
    pauseMessage?: string | null;
  }>;
  getRun: (id: number) => Promise<{
    id: number;
    resultId: number;
    flowId: number;
    projectId: number;
    result: string;
    stepProgress: unknown;
    currentNodeId: string | null;
    failedStepId: number | null;
    errorMessage: string | null;
    pauseMessage?: string | null;
  }>;
  pauseRun: (id: number) => Promise<unknown>;
  resumeRun: (id: number) => Promise<unknown>;
  stopRun: (id: number) => Promise<unknown>;
  exportRunExcel: (id: number) => Promise<string | null>;
  createFlowCommit: (body: {
    flowId: number;
    projectId: number;
    branch: string;
    baseCommitId: string | null;
    parentIds?: string[];
    message: string;
    graph: FlowGraph;
    sourceBranch?: string;
  }) => Promise<{
    commit: FlowCommit;
    graph: FlowGraph;
    manifest: FlowCommit;
  }>;
  saveFlowDraft: (body: {
    flowId: number;
    projectId: number;
    branch: string;
    baseCommitId: string | null;
    message: string;
    graph: FlowGraph;
  }) => Promise<{
    graph: FlowGraph;
    baseCommitId: string | null;
    updatedAt: string;
  }>;
  syncFlowDraft: (body: {
    flowId: number;
    projectId: number;
    branch: string;
    message: string;
  }) => Promise<{
    commit: FlowCommit;
    graph: FlowGraph;
    manifest: FlowCommit;
  }>;
  loadFlowDraft: (
    projectId: number,
    flowId: number,
    branch: string,
  ) => Promise<{
    graph: FlowGraph;
    baseCommitId: string | null;
    updatedAt: string;
  } | null>;
  downloadFlowCommit: (flowId: number, commitId: string) => Promise<{
    graph: FlowGraph;
    manifest: FlowCommit;
  }>;
  listManuals: (filters?: { flowId?: number; projectId?: number }) => Promise<
    Array<{
      id: number;
      projectId: number;
      flowId: number;
      title: string;
      createdAt: string;
      updatedAt: string;
      steps: Array<{
        id: number;
        manualId: number;
        orderIndex: number;
        name: string;
        description: string | null;
        stepNodeId: string | null;
        screenshotArtifactId: number | null;
        beforeScreenshotArtifactId: number | null;
        afterScreenshotArtifactId: number | null;
      }>;
    }>
  >;
  getManual: (id: number) => Promise<{
    id: number;
    projectId: number;
    flowId: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: number;
      manualId: number;
      orderIndex: number;
      name: string;
      description: string | null;
      stepNodeId: string | null;
      screenshotArtifactId: number | null;
      beforeScreenshotArtifactId: number | null;
      afterScreenshotArtifactId: number | null;
    }>;
  }>;
  createManual: (input: {
    projectId: number;
    flowId: number;
    title?: string;
    nodes?: Array<{ id?: string; data?: { label?: string; description?: string } }>;
  }) => Promise<{
    id: number;
    projectId: number;
    flowId: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: number;
      manualId: number;
      orderIndex: number;
      name: string;
      description: string | null;
      stepNodeId: string | null;
      screenshotArtifactId: number | null;
      beforeScreenshotArtifactId: number | null;
      afterScreenshotArtifactId: number | null;
    }>;
  }>;
  updateManual: (
    id: number,
    data: { title?: string },
  ) => Promise<{
    id: number;
    projectId: number;
    flowId: number;
    title: string;
    createdAt: string;
    updatedAt: string;
    steps: Array<{
      id: number;
      manualId: number;
      orderIndex: number;
      name: string;
      description: string | null;
      stepNodeId: string | null;
      screenshotArtifactId: number | null;
      beforeScreenshotArtifactId: number | null;
      afterScreenshotArtifactId: number | null;
    }>;
  }>;
  removeManual: (id: number) => Promise<{ ok: true }>;
  updateManualStep: (
    manualId: number,
    stepId: number,
    data: Partial<{
      name: string;
      description: string | null;
      orderIndex: number;
      screenshotArtifactId: number | null;
      beforeScreenshotArtifactId: number | null;
      afterScreenshotArtifactId: number | null;
    }>,
  ) => Promise<{
    id: number;
    manualId: number;
    orderIndex: number;
    name: string;
    description: string | null;
    stepNodeId: string | null;
    screenshotArtifactId: number | null;
    beforeScreenshotArtifactId: number | null;
    afterScreenshotArtifactId: number | null;
  }>;
  exportManualPdf: (body: {
    id: number;
    title: string;
    flowId: number;
    steps: Array<{
      name: string;
      description: string | null;
      beforeScreenshotArtifactId?: number | null;
      afterScreenshotArtifactId?: number | null;
      screenshotArtifactId?: number | null;
    }>;
  }) => Promise<string | null>;
  startCapture: (body: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: unknown[];
    edges: unknown[];
  }) => Promise<{ sessionId: string; url: string; warmedUpSteps: number }>;
  captureHtml: (body: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: unknown[];
    edges: unknown[];
  }) => Promise<{
    sessionId: string;
    catalog: HtmlCatalogItem[];
    url: string;
    warmedUpSteps: number;
  }>;
  sliceHtml: (
    sessionId: string,
    body: { hint?: HtmlLocateHint; pickedIds?: string[] },
  ) => Promise<{ htmlElements: string; candidates: HtmlCatalogItem[] }>;
  captureFields: (body: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: unknown[];
    edges: unknown[];
  }) => Promise<{
    sessionId: string;
    formFound: boolean;
    fields: AiFillField[];
    url: string;
    warmedUpSteps: number;
  }>;
  captureApis: (body: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: unknown[];
    edges: unknown[];
  }) => Promise<{
    sessionId: string;
    apis: CapturedApiCall[];
    url: string;
    warmedUpSteps: number;
    previousStepLabel: string;
  }>;
  startFieldPicker: (sessionId: string) => Promise<{ ok: true }>;
  stopFieldPicker: (sessionId: string) => Promise<{ ok: true }>;
  startTriggerPicker: (sessionId: string) => Promise<{ ok: true }>;
  stopTriggerPicker: (sessionId: string) => Promise<{ ok: true }>;
  highlightFields: (sessionId: string, fields: AiFillField[]) => Promise<{ ok: true }>;
  captureEvents: (
    sessionId: string,
    afterId?: number,
  ) => Promise<
    Array<{
      id: number;
      type: 'click' | 'fill' | 'press';
      scriptLine: string;
      detail: string;
      createdAt: string;
    }>
  >;
  stopCapture: (sessionId: string) => Promise<{ ok: true; eventCount: number }>;
  previewInput: (event: {
    type: string;
    x?: number;
    y?: number;
    button?: 'left' | 'right' | 'middle';
    clickCount?: number;
    deltaX?: number;
    deltaY?: number;
    key?: string;
    text?: string;
  }) => Promise<{ ok: boolean }>;
  getPreviewStatus: () => Promise<{
    active: boolean;
    viewport: { width: number; height: number };
  }>;
  getPageSnapshot: () => Promise<{ active: boolean; snapshot: string }>;
  onPreviewFrame: (
    cb: (payload: {
      data: string;
      metadata?: unknown;
      viewport?: { width: number; height: number };
    }) => void,
  ) => () => void;
  onPreviewStatus: (
    cb: (payload: { active: boolean; viewport?: { width: number; height: number } }) => void,
  ) => () => void;
  onPreviewFieldPicker: (
    cb: (payload: { sessionId: string; fields: AiFillField[] }) => void,
  ) => () => void;
  onPreviewTriggerPicker: (
    cb: (payload: {
      sessionId: string;
      trigger: { label: string; locatorCandidates: string[]; clickScriptLine: string };
    }) => void,
  ) => () => void;
};

declare global {
  interface Window {
    autoTester?: AutoTesterApi;
  }
}
