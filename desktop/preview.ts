import type { BrowserWindow } from 'electron';
import type { CDPSession, Page } from '@playwright/test';
import { capturePageSnapshot } from './pageSnapshot';
import type { AiFillField } from './types';

export type PreviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PreviewInputEvent = {
  type:
    | 'mousemove'
    | 'mousedown'
    | 'mouseup'
    | 'click'
    | 'dblclick'
    | 'wheel'
    | 'keydown'
    | 'keyup'
    | 'type';
  /** Coordinates in page viewport space (CSS pixels). */
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  deltaX?: number;
  deltaY?: number;
  key?: string;
  text?: string;
};

/**
 * Streams a Playwright page into the Electron UI via CDP screencast,
 * and forwards pointer/keyboard events from the Preview panel back to the page.
 * Keeps Chromium headless while still showing a live "in-app" browser.
 */
export class PreviewBridge {
  private win: BrowserWindow | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private viewport = { width: 1280, height: 720 };
  private active = false;

  setWindow(win: BrowserWindow | null) {
    this.win = win;
  }

  isActive() {
    return this.active;
  }

  getViewport() {
    return { ...this.viewport };
  }

  /**
   * Accessibility snapshot of the attached Preview page for AI generate / fill.
   * Returns empty snapshot when no page is live.
   */
  async captureSnapshot(): Promise<{ active: boolean; snapshot: string }> {
    if (!this.active || !this.page || this.page.isClosed()) {
      return { active: false, snapshot: '' };
    }
    const snapshot = await capturePageSnapshot(this.page);
    return { active: true, snapshot };
  }

  /**
   * Start screencasting `page` frames to the renderer.
   * Call after the Playwright page is created; stops any previous session first.
   */
  async attach(page: Page, opts?: { width?: number; height?: number }) {
    await this.detach();
    this.page = page;
    this.viewport = {
      width: Math.max(320, opts?.width || 1280),
      height: Math.max(240, opts?.height || 720),
    };

    try {
      await page.setViewportSize(this.viewport);
    } catch {
      // Page may already match; ignore.
    }

    this.cdp = await page.context().newCDPSession(page);
    this.active = true;
    this.emitStatus();

    this.cdp.on('Page.screencastFrame', (frame) => {
      void this.onFrame(frame);
    });

    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 55,
      maxWidth: this.viewport.width,
      maxHeight: this.viewport.height,
      everyNthFrame: 1,
    });
  }

  /** Stop screencast and clear the active page reference (does not close the browser). */
  async detach() {
    if (this.cdp) {
      try {
        await this.cdp.send('Page.stopScreencast');
      } catch {
        // already stopped
      }
      try {
        await this.cdp.detach();
      } catch {
        // ignore
      }
    }
    this.cdp = null;
    this.page = null;
    this.active = false;
    this.emitStatus();
  }

  /** Forward a UI input event onto the attached Playwright page. */
  async handleInput(event: PreviewInputEvent) {
    const page = this.page;
    if (!page) return;

    const button = event.button || 'left';
    const x = event.x ?? 0;
    const y = event.y ?? 0;

    switch (event.type) {
      case 'mousemove':
        await page.mouse.move(x, y);
        break;
      case 'mousedown':
        await page.mouse.move(x, y);
        await page.mouse.down({ button });
        break;
      case 'mouseup':
        await page.mouse.move(x, y);
        await page.mouse.up({ button });
        break;
      case 'click':
        await page.mouse.click(x, y, {
          button,
          clickCount: event.clickCount || 1,
        });
        break;
      case 'dblclick':
        await page.mouse.dblclick(x, y, { button });
        break;
      case 'wheel':
        await page.mouse.move(x, y);
        await page.mouse.wheel(event.deltaX || 0, event.deltaY || 0);
        break;
      case 'keydown':
        if (event.key) await page.keyboard.down(event.key);
        break;
      case 'keyup':
        if (event.key) await page.keyboard.up(event.key);
        break;
      case 'type':
        if (event.text) await page.keyboard.type(event.text, { delay: 0 });
        break;
      default:
        break;
    }
  }

  /** Send a field-picker selection from the live page to the renderer. */
  emitFieldPicker(sessionId: string, fields: AiFillField[]) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('preview:fieldPicker', { sessionId, fields });
    }
  }

  /** Send a captured validation trigger button to the renderer. */
  emitTriggerPicker(
    sessionId: string,
    trigger: { label: string; locatorCandidates: string[]; clickScriptLine: string },
  ) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('preview:triggerPicker', { sessionId, trigger });
    }
  }

  private async onFrame(frame: {
    data: string;
    sessionId: number;
    metadata: { offsetTop: number; pageScaleFactor: number; deviceWidth: number; deviceHeight: number; scrollOffsetX: number; scrollOffsetY: number; timestamp?: number };
  }) {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('preview:frame', {
        data: frame.data,
        metadata: frame.metadata,
        viewport: this.viewport,
      });
    }
    try {
      await this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
    } catch {
      // session ended
    }
  }

  private emitStatus() {
    if (this.win && !this.win.isDestroyed()) {
      this.win.webContents.send('preview:status', {
        active: this.active,
        viewport: this.viewport,
      });
    }
  }
}

export const previewBridge = new PreviewBridge();
