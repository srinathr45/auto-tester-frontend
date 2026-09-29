import { getDesktopApi } from '../../shared/http';
import type { AiFillField, CapturedApiCall, FlowEdge, FlowNode, HtmlCatalogItem, HtmlLocateHint } from '../../shared/types';

export interface RecordingEvent {
  id: number;
  type: 'click' | 'fill' | 'press';
  scriptLine: string;
  detail: string;
  createdAt: string;
}

/** @deprecated Use RecordingEvent */
export type CaptureEvent = RecordingEvent;

export const recordingService = {
  /**
   * Starts recording in Electron after warm-up of flow steps before untilNodeId
   * (Loop nodes are skipped — their script is navigate-back for Run only).
   */
  start: (data: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
  }) => getDesktopApi().startCapture(data),

  /**
   * Run prior steps, attach Preview, and index interactive controls (no page HTML).
   */
  captureHtml: (data: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
  }) => getDesktopApi().captureHtml(data),

  sliceHtml: (
    sessionId: string,
    body: { hint?: HtmlLocateHint; pickedIds?: string[] },
  ) =>
    getDesktopApi().sliceHtml(sessionId, body) as Promise<{
      htmlElements: string;
      candidates: HtmlCatalogItem[];
    }>,

  captureFields: (data: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
  }) => getDesktopApi().captureFields(data),

  captureApis: (data: {
    untilNodeId: string;
    url?: string;
    projectUrl?: string;
    nodes: FlowNode[];
    edges: FlowEdge[];
  }) =>
    getDesktopApi().captureApis(data) as Promise<{
      sessionId: string;
      apis: CapturedApiCall[];
      url: string;
      warmedUpSteps: number;
      previousStepLabel: string;
    }>,

  startFieldPicker: (sessionId: string) => getDesktopApi().startFieldPicker(sessionId),

  stopFieldPicker: (sessionId: string) => getDesktopApi().stopFieldPicker(sessionId),

  highlightFields: (sessionId: string, fields: AiFillField[]) =>
    getDesktopApi().highlightFields(sessionId, fields),

  onFieldPicker: (callback: (payload: { sessionId: string; fields: AiFillField[] }) => void) =>
    getDesktopApi().onPreviewFieldPicker(callback),

  startTriggerPicker: (sessionId: string) => getDesktopApi().startTriggerPicker(sessionId),

  stopTriggerPicker: (sessionId: string) => getDesktopApi().stopTriggerPicker(sessionId),

  onTriggerPicker: (
    callback: (payload: {
      sessionId: string;
      trigger: { label: string; locatorCandidates: string[]; clickScriptLine: string };
    }) => void,
  ) => getDesktopApi().onPreviewTriggerPicker(callback),

  events: (sessionId: string, afterId?: number) =>
    getDesktopApi().captureEvents(sessionId, afterId),

  stop: (sessionId: string) => getDesktopApi().stopCapture(sessionId),
};
