import type { Page } from '@playwright/test';

const MAX_ARIA = 12000;
const MAX_TEXT = 8000;
/** Stored on the flow node for AI script generate. */
const MAX_HTML_STORE = 200000;

/**
 * Accessibility tree for the LLM. Falls back to visible text when ariaSnapshot
 * is unavailable. Empty string if there is no live page.
 */
export async function capturePageSnapshot(page: Page | null | undefined): Promise<string> {
  if (!page || page.isClosed()) return '';
  try {
    const snap = await page.locator('body').ariaSnapshot({ timeout: 4000 });
    return String(snap || '').trim().slice(0, MAX_ARIA);
  } catch {
    try {
      const text = await page.locator('body').innerText({ timeout: 4000 });
      return String(text || '').trim().slice(0, MAX_TEXT);
    } catch {
      return '';
    }
  }
}

/** Drop scripts, styles, and comments so stored markup is locators, not assets. */
export function stripHeavyHtml(html: string): string {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

/**
 * Full-page markup with scripts/styles stripped. Prefer htmlNormalizer for AI script.
 */
export async function capturePageHtml(page: Page | null | undefined): Promise<string> {
  if (!page || page.isClosed()) return '';
  try {
    const raw = await page.evaluate(() => document.documentElement?.outerHTML || '');
    return stripHeavyHtml(String(raw || '')).slice(0, MAX_HTML_STORE);
  } catch {
    return '';
  }
}
