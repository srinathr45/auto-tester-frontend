import type { BrowserContext, Response } from '@playwright/test';
import type { FlowNode } from './types';

export const API_CAPTURE_SETTLE_MS = 500;
export const API_CAPTURE_BODY_MAX = 8000;

export interface CapturedApiCall {
  id: string;
  method: string;
  url: string;
  urlPattern: string;
  resourceType?: string;
  status: number;
  requestBody?: string;
  responseBody?: string;
  occurrence?: number;
}

export interface ApiRuntimeBinding {
  method: string;
  url: string;
  status: number;
  ok: boolean;
  request: { body: unknown };
  response: { body: unknown };
}

/** Keep XHR/fetch; drop CORS preflight and static assets. */
export function shouldCaptureNetwork(resourceType: string, method: string): boolean {
  const type = String(resourceType || '').toLowerCase();
  if (type !== 'xhr' && type !== 'fetch') return false;
  return String(method || '').toUpperCase() !== 'OPTIONS';
}

/** Pathname only so runtime matching ignores query strings and ids in search. */
export function urlPatternFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname || '/';
  } catch {
    const noQuery = String(url || '').split('?')[0];
    const scheme = noQuery.indexOf('://');
    if (scheme >= 0) {
      const pathStart = noQuery.indexOf('/', scheme + 3);
      return pathStart >= 0 ? noQuery.slice(pathStart) || '/' : '/';
    }
    return noQuery || '/';
  }
}

export function matchKey(method: string, urlPattern: string): string {
  return `${String(method || '').toUpperCase()} ${urlPattern}`;
}

/** Stamp 1-based occurrence among calls that share method + path. */
export function assignOccurrences(calls: CapturedApiCall[]): CapturedApiCall[] {
  const counts = new Map<string, number>();
  return calls.map((call) => {
    const key = matchKey(call.method, call.urlPattern);
    const occurrence = (counts.get(key) || 0) + 1;
    counts.set(key, occurrence);
    const id = `${call.method}:${call.urlPattern}:${occurrence}`;
    return { ...call, id, occurrence };
  });
}

export function findMatchingCall(
  selected: Pick<CapturedApiCall, 'method' | 'urlPattern' | 'occurrence'>,
  live: CapturedApiCall[],
): CapturedApiCall | undefined {
  const key = matchKey(selected.method, selected.urlPattern);
  const same = live.filter((call) => matchKey(call.method, call.urlPattern) === key);
  const occurrence =
    selected.occurrence && selected.occurrence > 0 ? selected.occurrence : 1;
  return same[occurrence - 1];
}

export function parseBody(raw: string | null | undefined): unknown {
  if (raw == null || raw === '') return raw ?? null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function toRuntimeBinding(call: CapturedApiCall): ApiRuntimeBinding {
  return {
    method: call.method,
    url: call.url,
    status: call.status,
    ok: call.status >= 200 && call.status < 300,
    request: { body: parseBody(call.requestBody) },
    response: { body: parseBody(call.responseBody) },
  };
}

export function truncateBody(raw: string | null | undefined): string | undefined {
  if (raw == null || raw === '') return undefined;
  return raw.length > API_CAPTURE_BODY_MAX ? raw.slice(0, API_CAPTURE_BODY_MAX) : raw;
}

/** True when the selected call never fired during the previous step. */
export function isApiNotFoundError(message: string): boolean {
  return /API not found/i.test(message) || /did not see/i.test(message);
}

/**
 * Classify API-check failures: missing call vs assertion/content mismatch.
 * Leaves an already-prefixed message unchanged.
 */
export function formatApiCheckError(message: string): string {
  const text = String(message || '').trim() || 'Unknown API check failure';
  if (isApiNotFoundError(text)) {
    return /^API not found/i.test(text) ? text : `API not found: ${text}`;
  }
  if (/^API error/i.test(text)) return text;
  return `API error: ${text}`;
}

/** Last non-loop step before untilNodeId — the step whose traffic we capture. */
export function previousNonLoopNode(
  ordered: FlowNode[],
  untilNodeId: string,
): FlowNode | null {
  const targetIndex = ordered.findIndex((node) => node.id === untilNodeId);
  if (targetIndex < 0) return null;
  for (let i = targetIndex - 1; i >= 0; i--) {
    if (ordered[i].data?.stepKind !== 'loop') return ordered[i];
  }
  return null;
}

/**
 * Immediate next executable node after fromIndex.
 * Loop nodes are skipped; unrelated steps stop the search so we only listen
 * when the next action is the API check.
 */
export function nextApiListenTarget(
  ordered: FlowNode[],
  fromIndex: number,
  skipIds: Set<string>,
): FlowNode | undefined {
  for (let j = fromIndex + 1; j < ordered.length; j++) {
    const node = ordered[j];
    if (skipIds.has(node.id)) continue;
    if (node.data?.stepKind === 'loop') continue;
    const apis = node.data?.apiValidate?.apis;
    if (
      node.data?.stepKind === 'apiValidate' &&
      Array.isArray(apis) &&
      apis.length > 0
    ) {
      return node;
    }
    return undefined;
  }
  return undefined;
}

async function snapshotPlaywrightResponse(
  response: Response,
): Promise<CapturedApiCall | null> {
  const request = response.request();
  const method = request.method();
  const resourceType = request.resourceType();
  if (!shouldCaptureNetwork(resourceType, method)) return null;

  let responseBody = '';
  try {
    responseBody = await response.text();
  } catch {
    responseBody = '';
  }

  return {
    id: '',
    method: method.toUpperCase(),
    url: response.url(),
    urlPattern: urlPatternFromUrl(response.url()),
    resourceType,
    status: response.status(),
    requestBody: truncateBody(request.postData()),
    responseBody: truncateBody(responseBody),
  };
}

/**
 * Listen on the context (covers popups) while `run` executes, then settle
 * so late XHRs are included. Returns occurrence-stamped calls.
 */
export async function collectApisDuring(
  target: BrowserContext,
  run: () => Promise<void>,
  settleMs = API_CAPTURE_SETTLE_MS,
): Promise<CapturedApiCall[]> {
  const pending: Promise<CapturedApiCall | null>[] = [];
  const onResponse = (response: Response) => {
    pending.push(snapshotPlaywrightResponse(response));
  };
  target.on('response', onResponse);
  try {
    await run();
    if (settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }
  } finally {
    target.off('response', onResponse);
  }
  const calls = (await Promise.all(pending)).filter(
    (call): call is CapturedApiCall => Boolean(call),
  );
  return assignOccurrences(calls);
}
