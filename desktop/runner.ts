import { chromium, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { uploadArtifact, patchManualStep } from './artifactUpload';
import { saveRunExcelToDownloads } from './excelReport';
import { pickAndCopyFile } from './reports/saveDownload';
import {
  collectApisDuring,
  findMatchingCall,
  formatApiCheckError,
  nextApiListenTarget,
  toRuntimeBinding,
  type CapturedApiCall,
} from './apiCapture';
import { orderNodesByEdges } from './orderNodes';
import { resolveLoopBody } from './loopGraph';
import { previewBridge } from './preview';
import {
  isUrlAssertMismatch,
  resolveExecutableScript,
  resolveNodeStepKind,
  runPlaywrightScript,
} from './stepScript';
import type {
  FlowEdge,
  FlowNode,
  RunSnapshot,
  StartRunBody,
  StepProgressItem,
} from './types';

type RunControl = { paused: boolean; stopped: boolean };
type StepOutcome = 'passed' | 'warned' | 'failed' | 'cancelled';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Attach Preview only for normal/Record runs — Manual captures without screencast. */
async function attachPreviewIfNeeded(
  page: Page | null,
  manualCapture: boolean,
): Promise<void> {
  if (manualCapture || !page || page.isClosed()) return;
  await previewBridge.attach(page, { width: 1280, height: 720 }).catch(() => undefined);
}

function emptySnapshot(body: StartRunBody): RunSnapshot {
  return {
    id: body.resultId,
    resultId: body.resultId,
    flowId: body.flowId,
    projectId: body.projectId,
    flowName: body.flowName,
    projectName: body.projectName,
    commitId: body.commitId || null,
    result: 'queued',
    stepProgress: null,
    currentNodeId: null,
    failedStepId: null,
    errorMessage: null,
    pauseMessage: null,
  };
}

/** Label shown in the Continue popup while the operator types OTP/captcha. */
function humanInputReason(node: FlowNode): string {
  return String(node.data?.description || '').trim() || node.data?.label || 'human input';
}

function videoDirFor(resultId: number): string {
  return path.join(os.tmpdir(), 'auto-tester-videos', String(resultId));
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^\w.-]+/g, '_').slice(0, 40) || 'run';
}

/** In-memory Playwright runner keyed by ephemeral resultId (not a Nest DB row). */
export class Runner {
  private readonly controls = new Map<number, RunControl>();
  private readonly snapshots = new Map<number, RunSnapshot>();
  /** Viewport PNGs keyed by resultId → nodeId, used to embed Excel locally. */
  private readonly screenshots = new Map<number, Map<string, Buffer>>();
  /** Traffic collected during the step before an API check, keyed by resultId then nodeId. */
  private readonly pendingApiTraffic = new Map<number, Map<string, CapturedApiCall[]>>();

  get(resultId: number): RunSnapshot | undefined {
    return this.snapshots.get(resultId);
  }

  /**
   * Rebuild Excel from the in-memory snapshot + screenshots (Run panel button).
   */
  async exportExcel(resultId: number): Promise<string | null> {
    const snap = this.snapshots.get(resultId);
    if (!snap) throw Object.assign(new Error(`No run ${resultId}`), { status: 404 });
    const dest = await saveRunExcelToDownloads(
      snap,
      this.screenshots.get(resultId) || new Map(),
    );
    if (!dest) return null;
    return dest;
  }

  private storeScreenshot(resultId: number, nodeId: string, buffer: Buffer) {
    let map = this.screenshots.get(resultId);
    if (!map) {
      map = new Map();
      this.screenshots.set(resultId, map);
    }
    map.set(nodeId, buffer);
  }

  start(body: StartRunBody): RunSnapshot {
    if (this.controls.has(body.resultId)) {
      throw Object.assign(new Error(`Run ${body.resultId} already active`), { status: 409 });
    }
    const snap = emptySnapshot(body);
    this.snapshots.set(body.resultId, snap);
    this.controls.set(body.resultId, { paused: false, stopped: false });

    void this.execute(body).catch((err) => {
      console.error(`Run ${body.resultId} crashed:`, err?.message || err);
      const snap = this.patch(body.resultId, {
        result: 'failed',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      this.controls.delete(body.resultId);
      this.pendingApiTraffic.delete(body.resultId);
      if (!body.manualCapture) {
        void saveRunExcelToDownloads(
          snap,
          this.screenshots.get(body.resultId) || new Map(),
        );
      }
    });

    return snap;
  }

  pause(resultId: number): RunSnapshot {
    const ctrl = this.controls.get(resultId);
    if (!ctrl) throw Object.assign(new Error(`No active run ${resultId}`), { status: 404 });
    ctrl.paused = true;
    return this.patch(resultId, { result: 'paused' });
  }

  resume(resultId: number): RunSnapshot {
    const ctrl = this.controls.get(resultId);
    if (!ctrl) throw Object.assign(new Error(`No active run ${resultId}`), { status: 404 });
    ctrl.paused = false;
    return this.patch(resultId, { result: 'running', pauseMessage: null });
  }

  stop(resultId: number): RunSnapshot {
    const ctrl = this.controls.get(resultId);
    if (ctrl) {
      ctrl.stopped = true;
      ctrl.paused = false;
    }
    return this.patch(resultId, {
      result: 'cancelled',
      errorMessage: 'Stopped by user',
      pauseMessage: null,
      currentNodeId: null,
    });
  }

  private patch(resultId: number, partial: Partial<RunSnapshot>): RunSnapshot {
    const current = this.snapshots.get(resultId) || {
      id: resultId,
      resultId,
      flowId: 0,
      projectId: 0,
      result: 'queued',
      stepProgress: null,
      currentNodeId: null,
      failedStepId: null,
      errorMessage: null,
      pauseMessage: null,
    };
    const next = { ...current, ...partial, id: resultId, resultId };
    this.snapshots.set(resultId, next);
    return next;
  }

  private async waitIfPausedOrStopped(resultId: number): Promise<boolean> {
    while (true) {
      const ctrl = this.controls.get(resultId);
      if (!ctrl || ctrl.stopped) return true;
      if (!ctrl.paused) return false;
      await sleep(200);
    }
  }

  /**
   * Pause the run so the user can type OTP/captcha in Preview, then Continue.
   * waitIfPausedOrStopped unblocks when they resume or stop.
   */
  private pauseForHumanInput(resultId: number, message: string) {
    const ctrl = this.controls.get(resultId);
    if (ctrl) ctrl.paused = true;
    this.patch(resultId, { result: 'paused', pauseMessage: message, errorMessage: null });
  }

  /**
   * Run a single non-loop step (script / AI fill / wait / etc.).
   * Updates progress[progressIndex] and returns the outcome + current page.
   * lookAheadNode: when the next action is an API check, collect xhr/fetch
   * during this step so that check can assert live calls.
   */
  private async executeOneStep(args: {
    body: StartRunBody;
    resultId: number;
    node: FlowNode;
    progressIndex: number;
    progress: StepProgressItem[];
    context: BrowserContext;
    page: Page;
    lookAheadNode?: FlowNode;
  }): Promise<{ outcome: StepOutcome; page: Page }> {
    const { body, resultId, node, progressIndex, progress, context, lookAheadNode } = args;
    let page = args.page;
    const kind = resolveNodeStepKind(node);
    const usePreview = !body.manualCapture;

    progress[progressIndex].status = 'running';
    this.patch(resultId, {
      result: 'running',
      currentNodeId: node.id,
      stepProgress: [...progress],
    });

    if (body.manualCapture) {
      await this.captureManualShot(body, page, node.id, 'before');
    }

    try {
      const scriptText = await resolveExecutableScript(page, node);
      const urlWarnings: string[] = [];
      const extraBindings =
        kind === 'apiValidate' ? this.apiCheckBindings(resultId, node) : {};

      const runBody = async () => {
        if (!scriptText) {
          if (kind !== 'inputWait') {
            throw new Error(
              kind === 'aiFill'
                ? 'Auto Form Filler has no saved script. Capture fields and generate the step before running.'
                : 'Script step has empty scriptText',
            );
          }
        } else {
          const nextPage = await runPlaywrightScript(
            scriptText,
            context,
            page,
            (msg) => urlWarnings.push(msg),
            true,
            Math.min(1000, Math.max(0, Number(body.lineDelayMs) || 0)),
            extraBindings,
          );
          if (nextPage && nextPage !== page) {
            page = nextPage;
            await attachPreviewIfNeeded(page, Boolean(body.manualCapture));
          }
        }

        if (kind === 'inputWait' && usePreview) {
          const reason = humanInputReason(node);
          this.pauseForHumanInput(
            resultId,
            `Paused for ${reason}. Please complete this and press Continue.`,
          );
          if (await this.waitIfPausedOrStopped(resultId)) {
            return;
          }
          this.patch(resultId, { result: 'running', errorMessage: null, pauseMessage: null });
        }
      };

      if (lookAheadNode) {
        const traffic = await collectApisDuring(context, runBody);
        this.storeApiTraffic(resultId, lookAheadNode.id, traffic);
      } else {
        await runBody();
      }

      if (await this.waitIfPausedOrStopped(resultId)) {
        return { outcome: 'cancelled', page };
      }

      if (urlWarnings.length) {
        progress[progressIndex].status = 'warned';
        progress[progressIndex].errorMessage = urlWarnings.join('\n---\n');
      } else {
        progress[progressIndex].status = 'passed';
        progress[progressIndex].errorMessage = null;
      }

      await this.captureStepScreenshot(body, page, progress[progressIndex]);
      if (body.manualCapture) {
        await this.captureManualShot(body, page, node.id, 'after');
      }
      this.patch(resultId, { stepProgress: [...progress] });
      return {
        outcome: urlWarnings.length ? 'warned' : 'passed',
        page,
      };
    } catch (err) {
      if (this.controls.get(resultId)?.stopped) {
        return { outcome: 'cancelled', page };
      }
      const message = err instanceof Error ? err.message : String(err);
      const displayMessage =
        kind === 'apiValidate' ? formatApiCheckError(message) : message;
      if (isUrlAssertMismatch(message)) {
        console.warn('[URL assert warning]', message);
        progress[progressIndex].status = 'warned';
        progress[progressIndex].errorMessage = message;
        await this.captureStepScreenshot(body, page, progress[progressIndex]);
        if (body.manualCapture) {
          await this.captureManualShot(body, page, node.id, 'after');
        }
        this.patch(resultId, { stepProgress: [...progress] });
        return { outcome: 'warned', page };
      }
      progress[progressIndex].status = 'failed';
      progress[progressIndex].errorMessage = displayMessage;
      await this.captureStepScreenshot(body, page, progress[progressIndex]);
      if (body.manualCapture) {
        await this.captureManualShot(body, page, node.id, 'after');
      }
      this.patch(resultId, {
        result: 'failed',
        currentNodeId: node.id,
        stepProgress: [...progress],
        failedStepId: progress[progressIndex].stepId ?? null,
        errorMessage: displayMessage,
        pauseMessage: null,
      });
      return { outcome: 'failed', page };
    }
  }

  private storeApiTraffic(resultId: number, nodeId: string, calls: CapturedApiCall[]) {
    let byNode = this.pendingApiTraffic.get(resultId);
    if (!byNode) {
      byNode = new Map();
      this.pendingApiTraffic.set(resultId, byNode);
    }
    byNode.set(nodeId, calls);
  }

  /**
   * Bind api1/api2/… from traffic collected during the previous step.
   * Throws when a selected call was not seen.
   */
  private apiCheckBindings(resultId: number, node: FlowNode): Record<string, unknown> {
    const selected = node.data?.apiValidate?.apis || [];
    if (!selected.length) return {};
    const traffic = this.pendingApiTraffic.get(resultId)?.get(node.id) || [];
    this.pendingApiTraffic.get(resultId)?.delete(node.id);
    const bindings: Record<string, unknown> = {};
    for (const item of selected) {
      const live = findMatchingCall(item.api, traffic);
      if (!live) {
        const occurrence = item.api.occurrence && item.api.occurrence > 1
          ? ` occurrence ${item.api.occurrence}`
          : '';
        throw new Error(
          `API not found: ${item.alias} ${item.api.method} ${item.api.urlPattern}${occurrence}`,
        );
      }
      bindings[item.alias] = toRuntimeBinding(live);
    }
    return bindings;
  }

  /**
   * Play the Loop node's navigate-back script before a repeat pass (iteration 2+).
   * Empty script is skipped so the first pass can use the page the previous step left.
   * Failures are attributed to the Loop step, not a body step.
   */
  private async runLoopNavigateBack(args: {
    loopNode: FlowNode;
    loopIndex: number;
    resultId: number;
    progress: StepProgressItem[];
    context: BrowserContext;
    page: Page;
    manualCapture?: boolean;
    lineDelayMs?: number;
  }): Promise<{ outcome: 'passed' | 'failed'; page: Page }> {
    const { loopNode, loopIndex, resultId, progress, context, manualCapture, lineDelayMs = 0 } =
      args;
    let page = args.page;
    const scriptText = String(loopNode.data?.scriptText || '').trim();
    if (!scriptText) return { outcome: 'passed', page };

    this.patch(resultId, {
      result: 'running',
      currentNodeId: loopNode.id,
      stepProgress: [...progress],
    });

    try {
      const nextPage = await runPlaywrightScript(
        scriptText,
        context,
        page,
        () => undefined,
        true,
        lineDelayMs,
      );
      if (nextPage && nextPage !== page) {
        page = nextPage;
        await attachPreviewIfNeeded(page, Boolean(manualCapture));
      }
      return { outcome: 'passed', page };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      progress[loopIndex].status = 'failed';
      progress[loopIndex].errorMessage = `Navigate back failed: ${message}`;
      this.patch(resultId, {
        result: 'failed',
        currentNodeId: loopNode.id,
        stepProgress: [...progress],
        failedStepId: progress[loopIndex].stepId ?? null,
        errorMessage: progress[loopIndex].errorMessage,
      });
      return { outcome: 'failed', page };
    }
  }

  private async finishCancelled(resultId: number, progress: StepProgressItem[]) {
    this.patch(resultId, {
      result: 'cancelled',
      currentNodeId: null,
      stepProgress: [...progress],
      errorMessage: 'Stopped by user',
      pauseMessage: null,
    });
  }

  /**
   * Viewport screenshot after a step, upload to MinIO, attach artifact id.
   * Used for every executed step so the Excel report can embed the image.
   */
  private async captureStepScreenshot(
    body: StartRunBody,
    page: Page | null,
    progressItem: StepProgressItem,
  ): Promise<void> {
    if (!page || page.isClosed()) return;
    try {
      const buffer = await page.screenshot({ type: 'png' });
      this.storeScreenshot(body.resultId, progressItem.nodeId, buffer);
      const uploaded = await uploadArtifact({
        projectId: body.projectId,
        flowId: body.flowId,
        resultId: body.resultId,
        stepNodeId: progressItem.nodeId,
        kind: 'screenshot',
        buffer,
        contentType: 'image/png',
        fileName: `${progressItem.nodeId}.png`,
      });
      if (uploaded?.id) {
        progressItem.screenshotArtifactId = uploaded.id;
      }
    } catch (err) {
      console.warn(
        '[runner] step screenshot failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Capture one before/after manual screenshot and PATCH the manual step.
   */
  private async captureManualShot(
    body: StartRunBody,
    page: Page | null,
    nodeId: string,
    phase: 'before' | 'after',
  ): Promise<number | null> {
    const capture = body.manualCapture;
    if (!capture || !page || page.isClosed()) return null;
    const manualStepId = capture.stepMap[nodeId];
    if (manualStepId == null) return null;

    try {
      const buffer = await page.screenshot({ type: 'png', fullPage: true });
      const uploaded = await uploadArtifact({
        projectId: body.projectId,
        flowId: body.flowId,
        manualId: capture.manualId,
        stepNodeId: `${nodeId}-${phase}`,
        kind: 'manual_screenshot',
        buffer,
        contentType: 'image/png',
        fileName: `${nodeId}-${phase}.png`,
      });
      if (!uploaded?.id) return null;

      const patch =
        phase === 'before'
          ? { beforeScreenshotArtifactId: uploaded.id }
          : {
              afterScreenshotArtifactId: uploaded.id,
              screenshotArtifactId: uploaded.id,
            };
      await patchManualStep(capture.manualId, manualStepId, patch);
      return uploaded.id;
    } catch (err) {
      console.warn(
        `[runner] manual ${phase} screenshot failed:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /**
   * Finalize Playwright video (must close page first). Returns the temp webm path.
   */
  private async finalizeVideo(
    body: StartRunBody,
    page: Page | null,
    context: BrowserContext | null,
  ): Promise<string | null> {
    if (!body.recordVideo) return null;
    try {
      let videoPath: string | null = null;
      if (page && !page.isClosed()) {
        const video = page.video();
        await page.close().catch(() => undefined);
        if (video) {
          videoPath = await video.path().catch(() => null);
        }
      }
      await context?.close().catch(() => undefined);

      if (!videoPath || !fs.existsSync(videoPath)) {
        const dir = videoDirFor(body.resultId);
        if (fs.existsSync(dir)) {
          const found = fs.readdirSync(dir).find((f) => f.endsWith('.webm'));
          if (found) videoPath = path.join(dir, found);
        }
      }

      if (videoPath && fs.existsSync(videoPath)) return videoPath;
      console.warn('[runner] no video file after recording');
      return null;
    } catch (err) {
      console.warn(
        '[runner] video finalize failed:',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /**
   * Ask where to save the recorded webm. Cancel skips the copy.
   */
  private async saveVideoWithDialog(
    snap: RunSnapshot,
    videoPath: string,
  ): Promise<string | null> {
    const flowPart = safeFilenamePart(snap.flowName || `flow-${snap.flowId}`);
    const statusPart = safeFilenamePart(snap.result || 'run');
    const dest = await pickAndCopyFile({
      defaultFilename: `run-${snap.resultId}-${flowPart}-${statusPart}.webm`,
      filters: [{ name: 'WebM video', extensions: ['webm'] }],
      sourcePath: videoPath,
    });
    if (dest) console.log(`[runner] video saved ${dest}`);
    return dest;
  }

  private async execute(body: StartRunBody): Promise<void> {
    const { resultId, projectUrl, recordVideo } = body;
    const lineDelayMs = Math.min(1000, Math.max(0, Number(body.lineDelayMs) || 0));
    const nodes = (body.nodes || []) as FlowNode[];
    const edges = (body.edges || []) as FlowEdge[];
    const ordered = orderNodesByEdges(nodes, edges);
    const indexById = new Map(ordered.map((node, index) => [node.id, index]));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    // Precompute Loop bodies (Repeat → … → Loop) and map body-start → loop id.
    const bodyStartToLoop = new Map<string, string>();
    const loopBodyIds = new Map<string, string[]>();
    for (const node of nodes) {
      if (resolveNodeStepKind(node) !== 'loop') continue;
      const { bodyIds } = resolveLoopBody(node.id, edges);
      loopBodyIds.set(node.id, bodyIds);
      if (bodyIds[0]) bodyStartToLoop.set(bodyIds[0], node.id);
    }
    const skipIds = new Set<string>();

    const progress: StepProgressItem[] = ordered.map((node) => ({
      nodeId: node.id,
      stepId: typeof node.data?.stepId === 'number' ? node.data.stepId : undefined,
      name: node.data?.label || 'Step',
      status: 'pending' as const,
      errorMessage: null,
      screenshotArtifactId: null,
    }));

    this.patch(resultId, {
      result: 'running',
      stepProgress: progress,
      currentNodeId: null,
      failedStepId: null,
      errorMessage: null,
      pauseMessage: null,
    });

    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    let context: BrowserContext | null = null;
    let sharedPage: Page | null = null;
    let recordedVideoPath: string | null = null;

    try {
      if (await this.waitIfPausedOrStopped(resultId)) {
        await this.finishCancelled(resultId, progress);
        return;
      }

      // Always headless — live view is the in-app Preview panel via CDP screencast.
      browser = await chromium.launch({ headless: true });

      const videoDir = recordVideo ? videoDirFor(resultId) : null;
      if (videoDir) {
        fs.mkdirSync(videoDir, { recursive: true });
      }

      context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        baseURL: projectUrl || undefined,
        ignoreHTTPSErrors: true,
        ...(videoDir
          ? { recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } } }
          : {}),
      });
      sharedPage = await context.newPage();
      // Manual: no Preview screencast. Clear any leftover session from a prior run.
      if (body.manualCapture) {
        await previewBridge.detach().catch(() => undefined);
      } else {
        await attachPreviewIfNeeded(sharedPage, false);
      }

      if (projectUrl) {
        try {
          await sharedPage.goto(projectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
          // First step may navigate explicitly.
        }
      }

      for (let i = 0; i < ordered.length; i++) {
        if (await this.waitIfPausedOrStopped(resultId)) {
          await this.finishCancelled(resultId, progress);
          return;
        }

        const node = ordered[i];
        if (skipIds.has(node.id)) continue;

        const kind = resolveNodeStepKind(node);

        // Body start of a Loop: run body × N, mark Loop passed, skip those nodes later.
        const owningLoopId = bodyStartToLoop.get(node.id);
        if (owningLoopId) {
          const loopNode = nodeById.get(owningLoopId);
          const bodyIds = loopBodyIds.get(owningLoopId) || [];
          const loopIndex = indexById.get(owningLoopId);
          if (!loopNode || loopIndex == null || bodyIds.length === 0) {
            progress[i].status = 'failed';
            progress[i].errorMessage = 'Loop body is incomplete';
            this.patch(resultId, {
              result: 'failed',
              currentNodeId: node.id,
              stepProgress: [...progress],
              failedStepId: progress[i].stepId ?? null,
              errorMessage: progress[i].errorMessage,
            });
            return;
          }

          const count = Math.max(1, Number(loopNode.data?.loop?.count) || 3);
          progress[loopIndex].status = 'running';
          this.patch(resultId, {
            result: 'running',
            currentNodeId: owningLoopId,
            stepProgress: [...progress],
          });

          let loopFailed = false;
          for (let iter = 0; iter < count && !loopFailed; iter++) {
            // After the first pass, restore the page/tab before repeating the body.
            if (iter > 0 && sharedPage && context) {
              if (await this.waitIfPausedOrStopped(resultId)) {
                await this.finishCancelled(resultId, progress);
                return;
              }
              const nav = await this.runLoopNavigateBack({
                loopNode,
                loopIndex,
                resultId,
                progress,
                context,
                page: sharedPage,
                manualCapture: Boolean(body.manualCapture),
                lineDelayMs,
              });
              sharedPage = nav.page;
              if (nav.outcome === 'failed') {
                loopFailed = true;
                break;
              }
            }
            for (const bodyId of bodyIds) {
              if (await this.waitIfPausedOrStopped(resultId)) {
                await this.finishCancelled(resultId, progress);
                return;
              }
              const bodyNode = nodeById.get(bodyId);
              const bodyIndex = indexById.get(bodyId);
              if (!bodyNode || bodyIndex == null) continue;
              if (!sharedPage) {
                progress[bodyIndex].status = 'failed';
                progress[bodyIndex].errorMessage = 'Browser page is not available';
                this.patch(resultId, {
                  result: 'failed',
                  currentNodeId: bodyId,
                  stepProgress: [...progress],
                  failedStepId: progress[bodyIndex].stepId ?? null,
                  errorMessage: progress[bodyIndex].errorMessage,
                });
                return;
              }
              const { outcome, page: nextPage } = await this.executeOneStep({
                body,
                resultId,
                node: bodyNode,
                progressIndex: bodyIndex,
                progress,
                context,
                page: sharedPage,
                lookAheadNode: nextApiListenTarget(ordered, bodyIndex, skipIds),
              });
              sharedPage = nextPage;
              if (outcome === 'cancelled') {
                await this.finishCancelled(resultId, progress);
                return;
              }
              if (outcome === 'failed') {
                loopFailed = true;
                break;
              }
            }
          }

          for (const bodyId of bodyIds) skipIds.add(bodyId);
          skipIds.add(owningLoopId);

          if (loopFailed) return;

          progress[loopIndex].status = 'passed';
          progress[loopIndex].errorMessage = null;
          this.patch(resultId, { stepProgress: [...progress] });
          continue;
        }

        if (kind === 'loop') {
          const { error } = resolveLoopBody(node.id, edges);
          progress[i].status = 'failed';
          progress[i].errorMessage =
            error || 'Connect Repeat to the first step you want to loop';
          this.patch(resultId, {
            result: 'failed',
            currentNodeId: node.id,
            stepProgress: [...progress],
            failedStepId: progress[i].stepId ?? null,
            errorMessage: progress[i].errorMessage,
          });
          return;
        }

        if (!sharedPage || !context) {
          progress[i].status = 'failed';
          progress[i].errorMessage = 'Browser page is not available';
          this.patch(resultId, {
            result: 'failed',
            currentNodeId: node.id,
            stepProgress: [...progress],
            failedStepId: progress[i].stepId ?? null,
            errorMessage: progress[i].errorMessage,
          });
          return;
        }

        const { outcome, page: nextPage } = await this.executeOneStep({
          body,
          resultId,
          node,
          progressIndex: i,
          progress,
          context,
          page: sharedPage,
          lookAheadNode: nextApiListenTarget(ordered, i, skipIds),
        });
        sharedPage = nextPage;
        if (outcome === 'cancelled') {
          await this.finishCancelled(resultId, progress);
          return;
        }
        if (outcome === 'failed') return;
      }

      this.patch(resultId, {
        result: progress.some((p) => p.status === 'warned') ? 'passed_with_warnings' : 'passed',
        currentNodeId: null,
        stepProgress: [...progress],
        failedStepId: null,
        errorMessage: null,
        pauseMessage: null,
      });
    } catch (err) {
      if (this.controls.get(resultId)?.stopped) {
        await this.finishCancelled(resultId, progress);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      await this.captureStepScreenshot(body, sharedPage, progress[progress.length - 1] || {
        nodeId: 'unknown',
        name: 'Run',
        status: 'failed',
      });
      this.patch(resultId, {
        result: 'failed',
        errorMessage: message,
        pauseMessage: null,
        stepProgress: [...progress],
      });
    } finally {
      await previewBridge.detach().catch(() => undefined);
      // Close page/context to finalize Playwright video before browser.close.
      if (recordVideo) {
        recordedVideoPath = await this.finalizeVideo(body, sharedPage, context);
        sharedPage = null;
        context = null;
      } else {
        await sharedPage?.close().catch(() => undefined);
        await context?.close().catch(() => undefined);
      }
      if (browser) {
        await browser.close().catch(() => undefined);
      }
      this.controls.delete(resultId);
      this.pendingApiTraffic.delete(resultId);
      const finalSnap = this.snapshots.get(resultId);
      // Excel first, then video — both ask for a path; Cancel skips that file.
      if (!body.manualCapture && finalSnap) {
        await saveRunExcelToDownloads(
          finalSnap,
          this.screenshots.get(resultId) || new Map(),
        );
      }
      if (recordedVideoPath && finalSnap) {
        await this.saveVideoWithDialog(finalSnap, recordedVideoPath);
      } else if (recordVideo && !recordedVideoPath) {
        console.warn('[runner] Record was on but no video file was produced');
      }
      if (recordVideo) {
        const dir = videoDirFor(resultId);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}

export const runner = new Runner();
