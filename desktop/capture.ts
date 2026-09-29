import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { dialog } from 'electron';
import {
  clearFieldPicker,
  clearTriggerPicker,
  highlightFields,
  installFieldPicker,
  installTriggerPicker,
  normalizePageFields,
} from './formNormalizer';
import {
  listHtmlCatalog,
  sliceHtmlByIds,
  sliceHtmlForHint,
  type HtmlCatalogItem,
  type HtmlLocateHint,
  type HtmlSliceResult,
} from './htmlNormalizer';
import { collectApisDuring, previousNonLoopNode, type CapturedApiCall } from './apiCapture';
import { orderNodesByEdges } from './orderNodes';
import { previewBridge } from './preview';
import { CSS_UTILITY_CLASS, isSafeCssClass, pickBestCssClasses } from './cssClassUtil';
import {
  resolveExecutableScript,
  resolveNodeStepKind,
  runPlaywrightScript,
} from './stepScript';
import type { CaptureEvent, FlowEdge, FlowNode, StartCaptureBody } from './types';

const PROBE_ATTR = 'data-at-probe';
const NAV_ASSERT_TIMEOUT_MS = 3000;
const NAV_DETECT_WINDOW_MS = 2500;
const NAV_POLL_MS = 100;
const MAX_NAME_LEN = 48;
const DEDUPE_MS = 400;
const FILE_PATH_PLACEHOLDER = 'REPLACE_WITH_FILE_PATH';

interface CaptureSession {
  id: string;
  browser: Browser;
  page: Page;
  events: CaptureEvent[];
  nextEventId: number;
  lastPolledIdByClient: number;
  recording: boolean;
  /** Monotonic id so only the latest click's nav watcher may emit an assert. */
  navWatchGeneration: number;
  /** Fingerprint of last recorded action for dedupe / click-before-fill collapse. */
  lastFingerprint?: string;
  lastEventAt?: number;
  lastFieldFp?: string;
  lastActionType?: 'click' | 'fill' | 'press' | 'selectOption' | 'check' | 'uncheck';
  /** Dialog count before the last click (for visibility assert). */
  dialogCountBefore?: number;
}

interface ElementPayload {
  type: 'click' | 'fill' | 'setInputFiles' | 'press' | 'selectOption' | 'check' | 'uncheck';
  /** Keyboard key for press actions (e.g. Enter on search). */
  key?: string;
  tagName?: string;
  id?: string;
  name?: string;
  testId?: string;
  typeAttr?: string;
  className?: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  /** title / tooltip on icon buttons */
  title?: string;
  placeholder?: string;
  labelText?: string;
  value?: string;
  /** True when the target is a contenteditable editor (rich text). */
  contentEditable?: boolean;
  /** Checkbox / radio checked state after the user action. */
  checked?: boolean;
  href?: string;
  ariaHasPopup?: string;
  /** Identifying text of the table row containing this control (if any). */
  rowName?: string;
  /** How the row is marked in the DOM: `tr` or `[role="row"]`. */
  rowSelector?: string;
  /** Index among a/button/[role=button] in the row (icon-only fallback). */
  actionIndexInRow?: number;
  /**
   * Short label of the field group wrapping this control (e.g. Zone / Status
   * for filter Clear buttons inside a <label>).
   */
  fieldGroupName?: string;
  /** Accessible name of containing dialog/modal (if any). */
  dialogName?: string;
  /** True when inside a dialog even if unnamed. */
  inDialog?: boolean;
  /** True when inside <nav> / role=navigation. */
  inNav?: boolean;
  /** Opener control name for hover menus. */
  hoverParentName?: string;
  hoverParentRole?: string;
  /** iframe locator: name=, title=, or url= */
  frameSelector?: string;
  /** <a target="_blank"> or equivalent. */
  targetBlank?: boolean;
  /** Viewport click coordinates (last-resort mouse replay). */
  clientX?: number;
  clientY?: number;
  /** Temporary stamp so Node can verify locators hit this exact element. */
  probeId?: string;
  /** Unique CSS path snapshot at click time (fallback locator). */
  cssPath?: string;
}

interface LocatorCandidate {
  detail: string;
  /** Script line for the primary action (click/fill). */
  actionLine: string;
  /** True for structural locators safe to use if the element navigates away before verify. */
  trustedWithoutProbe: boolean;
  /** Prefer over cssPath when probe verify is unavailable. */
  preferredFallback?: boolean;
  /** Higher = better. Priority: testid/id → accessible name → css → mouse. */
  rank?: number;
  locate: (page: Page) => Locator;
}

/** Max locators in a self-healing click/fill bundle. */
const HEAL_BUNDLE_MAX = 5;
const HEAL_TRY_TIMEOUT_MS = 3000;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeStr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeIdent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Escape special regex chars for a RegExp constructor pattern string. */
function escapeRegexPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escape for embedding inside a JS `/.../` regex literal (must escape `/` too). */
function escapeRegex(value: string): string {
  return escapeRegexPattern(value).replace(/\//g, '\\/');
}

function stableName(raw: string): string {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  const withoutCount = cleaned.replace(/\s*\(\d+\)\s*$/, '').trim();
  return (withoutCount || cleaned).slice(0, MAX_NAME_LEN);
}

function nameRegexSource(raw: string): string {
  return escapeRegex(stableName(raw));
}

/**
 * Reject concatenated filter-bar / multi-control text that must never become getByText.
 * The action is still captured — only this locator strategy is skipped.
 */
function isMegaText(raw?: string): boolean {
  if (!raw) return true;
  const s = raw.replace(/\s+/g, ' ').trim();
  if (!s) return true;
  if (s.length > MAX_NAME_LEN) return true;
  if ((s.match(/[▾▼]/g) || []).length >= 2) return true;
  if (/\bZONE\b.*\bSTATUS\b|\bSTATUS\b.*\bZONE\b/i.test(s)) return true;
  if ((s.match(/\bAll\b/gi) || []).length >= 2) return true;
  return false;
}

/** Roles that must use the full exact label (substring /Zone/i matches East/North/South Zone). */
function isExactNameRole(role?: string): boolean {
  return role === 'option' || role === 'menuitem' || role === 'treeitem';
}

/** Icon/action names that often appear many times on one page (Clear, Close, …). */
function isGenericActionName(name?: string): boolean {
  if (!name) return false;
  return /^(clear|close|remove|delete|edit|view|add|open|search|x|×)$/i.test(
    name.replace(/\s+/g, ' ').trim(),
  );
}

/**
 * For options/menuitems: use the visible label the user clicked.
 * Do not prefer short category aria-labels ("Zone" / "Status") over
 * real choices ("North Zone", "All") — aria often names the filter, not the option.
 */
function pickOptionLabel(payload: ElementPayload): string | undefined {
  const normalize = (s?: string) =>
    (s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME_LEN);

  const isBadOptionName = (s: string) => {
    if (!s) return true;
    if ((s.match(/[▾▼]/g) || []).length >= 2) return true;
    if (/\bZONE\b.*\bSTATUS\b|\bSTATUS\b.*\bZONE\b/i.test(s)) return true;
    return false;
  };

  const text = normalize(payload.text);
  const aria = normalize(payload.ariaLabel);
  const label = normalize(payload.labelText);

  // 1) Visible text wins (North Zone, All, Office Building, …).
  if (text && !isBadOptionName(text)) return text;

  // 2) If text missing, aria only when it isn't a vague category shorter than label.
  if (aria && !isBadOptionName(aria)) {
    if (label && !isBadOptionName(label) && label.length > aria.length) return label;
    return aria;
  }
  if (label && !isBadOptionName(label)) return label;
  return undefined;
}

/**
 * Best accessible name for locators.
 * Prefer visible text for buttons/links; options/menuitems use the most specific label.
 */
function pickShortName(payload: ElementPayload): string | undefined {
  const role = implicitRole(payload.tagName, payload.typeAttr, payload.role);

  if (isExactNameRole(role)) {
    return pickOptionLabel(payload);
  }

  // Buttons/links: visible label first (e.g. "Sign as Organization"), then aria/title.
  if (role === 'button' || role === 'link' || role === 'tab') {
    for (const candidate of [payload.text, payload.ariaLabel, payload.title, payload.labelText]) {
      if (candidate && !isMegaText(candidate)) return stableName(candidate);
    }
  }

  for (const candidate of [payload.ariaLabel, payload.title, payload.labelText, payload.text]) {
    if (candidate && !isMegaText(candidate)) return stableName(candidate);
  }
  // Mega text like "ZONE All ▾ STATUS All ▾" → try first segment before a caret.
  if (payload.text) {
    const first = payload.text.split(/[▾▼]/)[0]?.replace(/\s+/g, ' ').trim();
    if (first && !isMegaText(first) && first.length >= 2) return stableName(first);
  }
  return undefined;
}

function implicitRole(tagName?: string, typeAttr?: string, roleAttr?: string): string | undefined {
  if (roleAttr) return roleAttr;
  const tag = (tagName || '').toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'summary') return 'button';
  if (tag === 'select') return 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'input') {
    const t = (typeAttr || 'text').toLowerCase();
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    if (t === 'submit' || t === 'button' || t === 'reset') return 'button';
    return 'textbox';
  }
  return undefined;
}

function isUsefulHref(href?: string): href is string {
  if (!href) return false;
  const h = href.trim().toLowerCase();
  if (!h || h === '#' || h.startsWith('#') || h.startsWith('javascript:')) return false;
  return true;
}

/** Prefer path-contains href selectors — survives absolute vs relative href. */
function hrefLocatorSel(href: string): string {
  try {
    const u = new URL(href, 'http://local.invalid');
    const path = `${u.pathname}${u.search}`;
    if (path && path !== '/') {
      return `a[href*="${escapeIdent(path)}"]`;
    }
  } catch {
    /* fall through */
  }
  return `a[href="${escapeIdent(href)}"]`;
}

function rankSort(a: LocatorCandidate, b: LocatorCandidate): number {
  return (b.rank || 0) - (a.rank || 0);
}

function locatorExprFromActionLine(actionLine: string): string | null {
  const trimmed = actionLine.trim();
  const m = trimmed.match(
    /^await\s+(.+)\.(click|fill|setInputFiles|press|selectOption|check|uncheck)\s*\(/,
  );
  return m?.[1] || null;
}

function isMouseActionLine(actionLine: string): boolean {
  return /page\.mouse\.click\s*\(/.test(actionLine);
}

/** Turn fill locator candidates into press('Enter') lines for search submits. */
function toPressCandidates(
  candidates: LocatorCandidate[],
  key: string,
): LocatorCandidate[] {
  const pressKey = escapeStr(key || 'Enter');
  return candidates.map((c) => ({
    ...c,
    actionLine: c.actionLine.replace(
      /\.fill\([^)]*\)/,
      `.press('${pressKey}')`,
    ),
  }));
}

/**
 * Self-healing click/fill/press: try ranked locators until one works.
 * Scripts stay plain Playwright (no custom runner helpers required).
 */
function composeHealActionLines(
  candidates: LocatorCandidate[],
  kind: 'click' | 'fill' | 'press' | 'selectOption' | 'check' | 'uncheck',
  fillValue?: string,
  pressKey = 'Enter',
): string[] {
  const uniq: LocatorCandidate[] = [];
  const seen = new Set<string>();
  for (const c of [...candidates].sort(rankSort)) {
    if (seen.has(c.actionLine)) continue;
    seen.add(c.actionLine);
    uniq.push(c);
    if (uniq.length >= HEAL_BUNDLE_MAX) break;
  }
  if (uniq.length === 0) return [];
  if (uniq.length === 1 && (uniq[0].rank || 0) >= 90) {
    return [uniq[0].actionLine];
  }

  const tryParts: string[] = [];
  for (const c of uniq) {
    if (isMouseActionLine(c.actionLine)) {
      tryParts.push(
        `  try { ${c.actionLine.replace(/^await /, 'await ')} return; } catch (e) { __err = e; }`,
      );
      continue;
    }
    const expr = locatorExprFromActionLine(c.actionLine);
    if (!expr) {
      tryParts.push(
        `  try { ${c.actionLine} return; } catch (e) { __err = e; }`,
      );
      continue;
    }
    if (kind === 'fill') {
      const v = escapeStr(fillValue ?? '');
      tryParts.push(
        `  try { await ${expr}.first().fill('${v}', { timeout: ${HEAL_TRY_TIMEOUT_MS} }); return; } catch (e) { __err = e; }`,
      );
    } else if (kind === 'selectOption') {
      const v = escapeStr(fillValue ?? '');
      tryParts.push(
        `  try { await ${expr}.first().selectOption('${v}', { timeout: ${HEAL_TRY_TIMEOUT_MS} }); return; } catch (e) { __err = e; }`,
      );
    } else if (kind === 'check' || kind === 'uncheck') {
      tryParts.push(
        `  try { await ${expr}.first().${kind}({ timeout: ${HEAL_TRY_TIMEOUT_MS} }); return; } catch (e) { __err = e; }`,
      );
    } else if (kind === 'press') {
      tryParts.push(
        `  try { await ${expr}.first().press('${escapeStr(pressKey)}', { timeout: ${HEAL_TRY_TIMEOUT_MS} }); return; } catch (e) { __err = e; }`,
      );
    } else {
      tryParts.push(
        `  try { await ${expr}.first().click({ timeout: ${HEAL_TRY_TIMEOUT_MS} }); return; } catch (e) { __err = e; }`,
      );
    }
  }

  return [
    'await (async () => {',
    '  let __err;',
    ...tryParts,
    '  throw __err;',
    '})();',
  ];
}

/** React / Radix / MUI auto ids change every mount — never trust them as locators. */
function isEphemeralId(id?: string): boolean {
  if (!id) return true;
  const v = id.trim();
  if (!v) return true;
  if (v.includes(':')) return true;
  return /^(_r_|_r-|:r|radix-|mui-|react-|ember\d)/i.test(v);
}

function isStableId(id?: string): id is string {
  return !!id && !isEphemeralId(id);
}

const ACTIONABLE_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'summary',
  'option',
]);

const ACTIONABLE_ROLES = new Set([
  'button',
  'tab',
  'link',
  'menuitem',
  'option',
  'checkbox',
  'radio',
  'switch',
  'combobox',
  'listbox',
  'treeitem',
  'textbox',
  'searchbox',
  'menuitemcheckbox',
  'menuitemradio',
]);

/**
 * Skip layout wrappers (form/div/main/…) so accidental misses are not recorded.
 * Real controls (button/link/input/role/aria-haspopup) still pass.
 */
function isActionablePayload(payload: ElementPayload): boolean {
  const tag = (payload.tagName || '').toLowerCase();
  if (tag === 'input' && (payload.typeAttr || '').toLowerCase() === 'hidden') return false;
  if (payload.contentEditable) return true;
  if (ACTIONABLE_TAGS.has(tag)) return true;
  if (payload.role && ACTIONABLE_ROLES.has(payload.role)) return true;
  if (payload.ariaHasPopup) return true;
  if (isUsefulHref(payload.href)) return true;
  return false;
}

function fieldFingerprint(payload: ElementPayload): string {
  return [
    (payload.tagName || '').toLowerCase(),
    payload.testId || '',
    isStableId(payload.id) ? payload.id : '',
    payload.name || '',
    payload.placeholder || '',
    payload.cssPath || '',
  ].join('|');
}

function urlAssertLine(urlAfter: string): string {
  let patternArg: string;
  try {
    const u = new URL(urlAfter);
    const path = `${u.pathname}${u.search}${u.hash}` || '/';
    patternArg = JSON.stringify(escapeRegexPattern(path));
  } catch {
    patternArg = JSON.stringify(escapeRegexPattern(urlAfter));
  }
  // Soft assert: URL id drift (view/16 vs view/17) warns and continues.
  return (
    'try {\n' +
    `  await expect(page).toHaveURL(new RegExp(${patternArg}), { timeout: ${NAV_ASSERT_TIMEOUT_MS} });\n` +
    '} catch (e) {\n' +
    "  console.warn('[URL assert warning]', e && e.message ? e.message : e);\n" +
    '}'
  );
}

function withNth(actionLine: string, index: number): string {
  if (index <= 0) return actionLine;
  // Insert .nth(i) before .click() / .fill(...)
  return actionLine.replace(/\.(click|fill|selectOption|check|uncheck)\(/, `.nth(${index}).$1(`);
}

/**
 * Table/grid icon actions: scope the control to its row so we don't click the
 * same icon class on another row. Only adds candidates when rowName is present —
 * non-table clicks are unchanged.
 *
 * Prefer `tr` / `[role=row]` + hasText over accessible row name.
 * Prefer href / title / action-index over bare getByRole('button', View).
 */
function pushRowScopedClickCandidates(
  payload: ElementPayload,
  out: LocatorCandidate[],
): void {
  const rowName = (payload.rowName || '').trim();
  if (!rowName || isMegaText(rowName)) return;

  const rowRx = nameRegexSource(rowName);
  const rowRe = new RegExp(escapeRegexPattern(stableName(rowName)), 'i');
  const tag = (payload.tagName || 'button').toLowerCase();
  const actionLabel =
    [payload.ariaLabel, payload.title, payload.text]
      .map((s) => (s || '').replace(/\s+/g, ' ').trim())
      .find((s) => s && !isMegaText(s) && s.length >= 2) || undefined;

  const rowRoots: Array<{
    expr: string;
    locate: (p: Page) => Locator;
    detailPrefix: string;
    rankBoost: number;
  }> = [
    {
      expr: `page.locator('tr').filter({ hasText: /${rowRx}/i })`,
      locate: (p) => p.locator('tr').filter({ hasText: rowRe }),
      detailPrefix: `tr.hasText~/${stableName(rowName)}/i`,
      rankBoost: 4,
    },
    {
      expr: `page.getByRole('row').filter({ hasText: /${rowRx}/i })`,
      locate: (p) => p.getByRole('row').filter({ hasText: rowRe }),
      detailPrefix: `row.hasText~/${stableName(rowName)}/i`,
      rankBoost: 2,
    },
    {
      expr: `page.getByRole('row', { name: /${rowRx}/i })`,
      locate: (p) => p.getByRole('row', { name: rowRe }),
      detailPrefix: `row.name~/${stableName(rowName)}/i`,
      rankBoost: 0,
    },
  ];

  // If capture knew the row was a plain <tr>, prefer that first (already first).
  if (payload.rowSelector === '[role="row"]') {
    rowRoots.unshift({
      expr: `page.locator('[role="row"]').filter({ hasText: /${rowRx}/i })`,
      locate: (p) => p.locator('[role="row"]').filter({ hasText: rowRe }),
      detailPrefix: `[role=row].hasText~/${stableName(rowName)}/i`,
      rankBoost: 5,
    });
  }

  for (const root of rowRoots) {
    const { expr: rowExpr, locate: rowLocate, detailPrefix, rankBoost } = root;

    // 1) Navigation / view links by href — strongest for table actions.
    if (isUsefulHref(payload.href)) {
      const href = payload.href;
      const sel = hrefLocatorSel(href);
      out.push({
        detail: `${detailPrefix} ${sel}`,
        actionLine: `await ${rowExpr}.locator('${sel}').click();`,
        trustedWithoutProbe: false,
        preferredFallback: true,
        rank: 92 + rankBoost,
        locate: (p) => {
          try {
            const u = new URL(href, 'http://local.invalid');
            const path = `${u.pathname}${u.search}`;
            if (path && path !== '/') {
              return rowLocate(p).locator(`a[href*="${path}"]`);
            }
          } catch {
            /* ignore */
          }
          return rowLocate(p).locator(`a[href="${href}"]`);
        },
      });
    }

    if (actionLabel) {
      const aRx = nameRegexSource(actionLabel);
      const aRe = new RegExp(escapeRegexPattern(stableName(actionLabel)), 'i');
      out.push({
        detail: `${detailPrefix} title~/${stableName(actionLabel)}/i`,
        actionLine: `await ${rowExpr}.getByTitle(/${aRx}/i).click();`,
        trustedWithoutProbe: false,
        preferredFallback: true,
        rank: 88 + rankBoost,
        locate: (p) => rowLocate(p).getByTitle(aRe),
      });
      out.push({
        detail: `${detailPrefix} label~/${stableName(actionLabel)}/i`,
        actionLine: `await ${rowExpr}.getByLabel(/${aRx}/i).click();`,
        trustedWithoutProbe: false,
        preferredFallback: true,
        rank: 86 + rankBoost,
        locate: (p) => rowLocate(p).getByLabel(aRe),
      });
      out.push({
        detail: `${detailPrefix} link~/${stableName(actionLabel)}/i`,
        actionLine: `await ${rowExpr}.getByRole('link', { name: /${aRx}/i }).click();`,
        trustedWithoutProbe: false,
        preferredFallback: true,
        rank: 84 + rankBoost,
        locate: (p) => rowLocate(p).getByRole('link', { name: aRe }),
      });
      out.push({
        detail: `${detailPrefix} button~/${stableName(actionLabel)}/i`,
        actionLine: `await ${rowExpr}.getByRole('button', { name: /${aRx}/i }).click();`,
        trustedWithoutProbe: false,
        preferredFallback: !isGenericActionName(actionLabel),
        rank: 70 + rankBoost,
        locate: (p) => rowLocate(p).getByRole('button', { name: aRe }),
      });
    }

    // Icon-only / unnamed: nth among interactive cells.
    if (
      typeof payload.actionIndexInRow === 'number' &&
      payload.actionIndexInRow >= 0
    ) {
      const idx = payload.actionIndexInRow;
      out.push({
        detail: `${detailPrefix} actionNth=${idx}`,
        actionLine: `await ${rowExpr}.locator('a, button, [role="button"]').nth(${idx}).click();`,
        trustedWithoutProbe: false,
        preferredFallback: true,
        rank: 78 + rankBoost,
        locate: (p) =>
          rowLocate(p).locator('a, button, [role="button"]').nth(idx),
      });
    }

    if (tag === 'button' || payload.role === 'button') {
      const iconClass = String(payload.className || '')
        .trim()
        .split(/\s+/)
        .find((c) => c && isSafeCssClass(c) && /icon/i.test(c) && !CSS_UTILITY_CLASS.test(c));
      if (iconClass) {
        const sel = `button.${escapeIdent(iconClass)}`;
        out.push({
          detail: `${detailPrefix} ${sel}`,
          actionLine: `await ${rowExpr}.locator('${sel}').click();`,
          trustedWithoutProbe: false,
          preferredFallback: true,
          rank: 76 + rankBoost,
          locate: (p) => rowLocate(p).locator(`button.${iconClass}`),
        });
      }
    }
  }
}

/**
 * Dialog/modal actions: scope the control to its dialog so Save/Cancel don't hit the page behind.
 * Only adds candidates when inDialog / dialogName is set.
 */
function pushDialogScopedClickCandidates(
  payload: ElementPayload,
  out: LocatorCandidate[],
): void {
  if (!payload.inDialog && !payload.dialogName) return;

  const tag = (payload.tagName || 'button').toLowerCase();
  const actionLabel =
    [payload.ariaLabel, payload.title, payload.text]
      .map((s) => (s || '').replace(/\s+/g, ' ').trim())
      .find((s) => s && !isMegaText(s) && s.length >= 2) ||
    pickShortName(payload);

  const dialogName = (payload.dialogName || '').trim();
  const hasName = dialogName && !isMegaText(dialogName);

  const dialogRoot = (p: Page) => {
    if (hasName) {
      const re = new RegExp(escapeRegexPattern(stableName(dialogName)), 'i');
      return p.getByRole('dialog', { name: re });
    }
    return p.getByRole('dialog');
  };

  const dialogExpr = hasName
    ? `page.getByRole('dialog', { name: /${nameRegexSource(dialogName)}/i })`
    : `page.getByRole('dialog')`;

  if (actionLabel) {
    const aRx = nameRegexSource(actionLabel);
    const aRe = new RegExp(escapeRegexPattern(stableName(actionLabel)), 'i');
    const role = implicitRole(payload.tagName, payload.typeAttr, payload.role) || 'button';
    out.push({
      detail: `dialog${hasName ? `~/${stableName(dialogName)}/i` : ''} action~/${stableName(actionLabel)}/i`,
      actionLine: `await ${dialogExpr}.getByRole('${escapeStr(role)}', { name: /${aRx}/i }).click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 85,
      locate: (p) => dialogRoot(p).getByRole(role as 'button', { name: aRe }),
    });
    out.push({
      detail: `dialog${hasName ? `~/${stableName(dialogName)}/i` : ''} label~/${stableName(actionLabel)}/i`,
      actionLine: `await ${dialogExpr}.getByLabel(/${aRx}/i).click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 84,
      locate: (p) => dialogRoot(p).getByLabel(aRe),
    });
  }

  if (isUsefulHref(payload.href) && (tag === 'a' || payload.role === 'link')) {
    const href = payload.href;
    const sel = hrefLocatorSel(href);
    out.push({
      detail: `dialog ${sel}`,
      actionLine: `await ${dialogExpr}.locator('${sel}').click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 90,
      locate: (p) => {
        try {
          const u = new URL(href, 'http://local.invalid');
          const path = `${u.pathname}${u.search}`;
          if (path && path !== '/') return dialogRoot(p).locator(`a[href*="${path}"]`);
        } catch {
          /* ignore */
        }
        return dialogRoot(p).locator(`a[href="${href}"]`);
      },
    });
  }
}

/**
 * Filter / search Clear (and similar) buttons: scope to the wrapping <label>
 * field name so Zone Clear ≠ Status Clear ≠ search Clear.
 */
function pushFieldScopedClickCandidates(
  payload: ElementPayload,
  out: LocatorCandidate[],
): void {
  const field = (payload.fieldGroupName || '').trim();
  if (!field || isMegaText(field)) return;

  const tag = (payload.tagName || 'button').toLowerCase();
  if (tag !== 'button' && payload.role !== 'button') return;

  const actionLabel =
    [payload.ariaLabel, payload.title, payload.text]
      .map((s) => (s || '').replace(/\s+/g, ' ').trim())
      .find((s) => s && !isMegaText(s) && s.length >= 2) || undefined;
  if (!actionLabel) return;

  const fRx = nameRegexSource(field);
  const fRe = new RegExp(escapeRegexPattern(stableName(field)), 'i');
  const aRx = nameRegexSource(actionLabel);
  const aRe = new RegExp(escapeRegexPattern(stableName(actionLabel)), 'i');
  const fieldRoot = (p: Page) =>
    p.locator('label').filter({ hasText: fRe });

  out.push({
    detail: `field~/${stableName(field)}/i action~/${stableName(actionLabel)}/i`,
    actionLine: `await page.locator('label').filter({ hasText: /${fRx}/i }).getByRole('button', { name: /${aRx}/i }).click();`,
    trustedWithoutProbe: false,
    preferredFallback: true,
    rank: 87,
    locate: (p) => fieldRoot(p).getByRole('button', { name: aRe }),
  });
  out.push({
    detail: `field~/${stableName(field)}/i label~/${stableName(actionLabel)}/i`,
    actionLine: `await page.locator('label').filter({ hasText: /${fRx}/i }).getByLabel(/${aRx}/i).click();`,
    trustedWithoutProbe: false,
    preferredFallback: true,
    rank: 88,
    locate: (p) => fieldRoot(p).getByLabel(aRe),
  });
}

/**
 * Prefer unique CSS classes before ambiguous role names (e.g. registry-search-clear).
 */
function pushSpecificClassClickCandidates(
  payload: ElementPayload,
  out: LocatorCandidate[],
): void {
  const tag = (payload.tagName || 'div').toLowerCase();
  const optionName = pickShortName(payload);
  const best = pickBestCssClasses(payload.className, 2);
  for (const cls of best) {
    // Shared form-select-clear alone is not specific enough.
    if (/^form-select-clear$/i.test(cls)) continue;
    if (!isSafeCssClass(cls)) continue;
    const sel = `${tag}.${escapeIdent(cls)}`;
    const isSelectOption = /(^|\b)form-select-option\b/i.test(cls);
    const optionNameRx =
      isSelectOption && optionName ? nameRegexSource(optionName) : undefined;
    const optionNameRe = optionName
      ? new RegExp(escapeRegexPattern(stableName(optionName)), 'i')
      : undefined;
    const locate = (p: Page) => {
      const root = p.locator(`${tag}.${cls}`);
      return optionNameRe && isSelectOption
        ? root.filter({ hasText: optionNameRe })
        : root;
    };
    const actionTarget = optionNameRx
      ? `page.locator('${sel}').filter({ hasText: /${optionNameRx}/i })`
      : `page.locator('${sel}')`;
    // Bare CSS is below name-based locators; only class+option text may outrank.
    const distinctive = /search|registry|unique/i.test(cls);
    out.push({
      detail: optionNameRx ? `${sel} hasText~/${stableName(optionName!)}/i` : sel,
      actionLine: `await ${actionTarget}.click();`,
      trustedWithoutProbe: false,
      preferredFallback: Boolean(optionNameRx),
      rank: optionNameRx ? 94 : distinctive ? 42 : 35,
      locate,
    });
  }
}

function pushDialogScopedFillCandidates(
  payload: ElementPayload,
  out: LocatorCandidate[],
  value: string,
): void {
  if (!payload.inDialog && !payload.dialogName) return;

  const dialogName = (payload.dialogName || '').trim();
  const hasName = dialogName && !isMegaText(dialogName);
  const dialogRoot = (p: Page) => {
    if (hasName) {
      const re = new RegExp(escapeRegexPattern(stableName(dialogName)), 'i');
      return p.getByRole('dialog', { name: re });
    }
    return p.getByRole('dialog');
  };
  const dialogExpr = hasName
    ? `page.getByRole('dialog', { name: /${nameRegexSource(dialogName)}/i })`
    : `page.getByRole('dialog')`;

  if (payload.placeholder && !isMegaText(payload.placeholder)) {
    const ph = payload.placeholder;
    const rxSrc = nameRegexSource(ph);
    const rx = new RegExp(escapeRegexPattern(stableName(ph)), 'i');
    out.push({
      detail: `dialog placeholder~/${stableName(ph)}/i`,
      actionLine: `await ${dialogExpr}.getByPlaceholder(/${rxSrc}/i).fill('${value}');`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 80,
      locate: (p) => dialogRoot(p).getByPlaceholder(rx),
    });
  }

  const label = (payload.labelText || payload.ariaLabel || '').trim();
  if (label && !isMegaText(label)) {
    const rxSrc = nameRegexSource(label);
    const rx = new RegExp(escapeRegexPattern(stableName(label)), 'i');
    out.push({
      detail: `dialog label~/${stableName(label)}/i`,
      actionLine: `await ${dialogExpr}.getByLabel(/${rxSrc}/i).fill('${value}');`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 89,
      locate: (p) => dialogRoot(p).getByLabel(rx),
    });
  }
}

/** Prefix candidates with frameLocator when the target lived inside an iframe. */
function applyFrameScope(
  payload: ElementPayload,
  candidates: LocatorCandidate[],
): LocatorCandidate[] {
  const fs = payload.frameSelector;
  if (!fs) return candidates;
  const prefix = `page.frameLocator(${JSON.stringify(fs)})`;
  return candidates.map((c) => ({
    ...c,
    detail: `frame=${fs} ${c.detail}`,
    actionLine: isMouseActionLine(c.actionLine)
      ? c.actionLine
      : c.actionLine.replace(/^await page\./, `await ${prefix}.`),
    locate: (p: Page) => {
      if (isMouseActionLine(c.actionLine)) return c.locate(p);
      const root = p.frameLocator(fs);
      // FrameLocator shares getByRole/locator/getByLabel with Page for our usages.
      return c.locate(root as unknown as Page);
    },
  }));
}

function wrapNewTabClick(clickLine: string): string {
  const inner = clickLine.replace(/^await\s+/, '').replace(/;\s*$/, '');
  return [
    'await Promise.all([',
    '  (async () => { const p = await context.waitForEvent(\'page\'); await p.waitForLoadState(\'domcontentloaded\'); page = p; })(),',
    `  ${inner},`,
    ']);',
  ].join('\n');
}

function dialogVisibleAssertLine(dialogName?: string): string {
  if (dialogName && !isMegaText(dialogName)) {
    return `await expect(page.getByRole('dialog', { name: /${nameRegexSource(dialogName)}/i })).toBeVisible({ timeout: ${NAV_ASSERT_TIMEOUT_MS} });`;
  }
  return `await expect(page.getByRole('dialog')).toBeVisible({ timeout: ${NAV_ASSERT_TIMEOUT_MS} });`;
}

/** Ranked click locator candidates for one stamped element. */
function buildClickCandidates(payload: ElementPayload): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  const role = implicitRole(payload.tagName, payload.typeAttr, payload.role);
  const shortName = pickShortName(payload);
  const tag = (payload.tagName || 'div').toLowerCase();

  if (payload.testId) {
    const id = payload.testId;
    out.push({
      detail: `testid=${id}`,
      actionLine: `await page.getByTestId('${escapeStr(id)}').click();`,
      trustedWithoutProbe: true,
      rank: 100,
      locate: (p) => p.getByTestId(id),
    });
  }

  if (isStableId(payload.id)) {
    const sel = `#${escapeIdent(payload.id)}`;
    out.push({
      detail: sel,
      actionLine: `await page.locator('${sel}').click();`,
      trustedWithoutProbe: true,
      rank: 95,
      locate: (p) => p.locator(`#${payload.id}`),
    });
  }

  // Global href (nav / view links) — high rank; path-contains survives abs/rel.
  if (isUsefulHref(payload.href) && (role === 'link' || tag === 'a')) {
    const href = payload.href;
    const sel = hrefLocatorSel(href);
    out.push({
      detail: sel,
      actionLine: `await page.locator('${sel}').click();`,
      trustedWithoutProbe: true,
      preferredFallback: true,
      rank: payload.rowName ? 89 : 93,
      locate: (p) => {
        try {
          const u = new URL(href, 'http://local.invalid');
          const path = `${u.pathname}${u.search}`;
          if (path && path !== '/') return p.locator(`a[href*="${path}"]`);
        } catch {
          /* ignore */
        }
        return p.locator(`a[href="${href}"]`);
      },
    });
  }

  // Context scopes before ambiguous global roles.
  pushRowScopedClickCandidates(payload, out);
  pushDialogScopedClickCandidates(payload, out);
  pushFieldScopedClickCandidates(payload, out);
  pushSpecificClassClickCandidates(payload, out);

  // Nav landmark: link/button inside <nav>.
  if (payload.inNav && shortName && (role === 'link' || role === 'button' || tag === 'a')) {
    const rxSrc = nameRegexSource(shortName);
    const rx = new RegExp(escapeRegexPattern(shortName), 'i');
    const innerRole = role === 'button' ? 'button' : 'link';
    out.push({
      detail: `nav ${innerRole}~/${shortName}/i`,
      actionLine: `await page.getByRole('navigation').getByRole('${innerRole}', { name: /${rxSrc}/i }).click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 83,
      locate: (p) =>
        p.getByRole('navigation').getByRole(innerRole as 'link', { name: rx }),
    });
  }

  // Icon-only named controls (aria-label/title).
  const iconLabel = [payload.ariaLabel, payload.title]
    .map((s) => (s || '').replace(/\s+/g, ' ').trim())
    .find((s) => s && !isMegaText(s) && s.length >= 2);
  const visibleText = (payload.text || '').replace(/\s+/g, ' ').trim();
  const isIconOnly =
    (tag === 'button' || role === 'button' || tag === 'a' || role === 'link') &&
    !!iconLabel &&
    (!visibleText || visibleText.length < 2 || visibleText === iconLabel);
  if (isIconOnly && iconLabel) {
    const aRx = nameRegexSource(iconLabel);
    const aRe = new RegExp(escapeRegexPattern(stableName(iconLabel)), 'i');
    const preferGlobalIcon = !isGenericActionName(iconLabel);
    out.push({
      detail: `title~/${stableName(iconLabel)}/i`,
      actionLine: `await page.getByTitle(/${aRx}/i).click();`,
      trustedWithoutProbe: false,
      preferredFallback: preferGlobalIcon,
      rank: preferGlobalIcon ? 72 : 40,
      locate: (p) => p.getByTitle(aRe),
    });
    out.push({
      detail: `icon label~/${stableName(iconLabel)}/i`,
      actionLine: `await page.getByRole('button', { name: /${aRx}/i }).click();`,
      trustedWithoutProbe: false,
      preferredFallback: preferGlobalIcon,
      rank: preferGlobalIcon ? 68 : 35,
      locate: (p) => p.getByRole('button', { name: aRe }),
    });
    out.push({
      detail: `icon getByLabel~/${stableName(iconLabel)}/i`,
      actionLine: `await page.getByLabel(/${aRx}/i).click();`,
      trustedWithoutProbe: false,
      preferredFallback: preferGlobalIcon,
      rank: preferGlobalIcon ? 70 : 38,
      locate: (p) => p.getByLabel(aRe),
    });
  }

  if (role && shortName) {
    const r = escapeStr(role);
    const preferRole = !isGenericActionName(shortName);
    if (isExactNameRole(role)) {
      out.push({
        detail: `role=${role} name="${shortName}" exact`,
        actionLine: `await page.getByRole('${r}', { name: '${escapeStr(shortName)}', exact: true }).click();`,
        trustedWithoutProbe: false,
        preferredFallback: preferRole,
        // id/testid > accessible name > css/mouse
        rank: 90,
        locate: (p) => p.getByRole(role as 'option', { name: shortName, exact: true }),
      });
    } else {
      const rxSrc = nameRegexSource(shortName);
      const rx = new RegExp(escapeRegexPattern(shortName), 'i');
      out.push({
        detail: `role=${role} name~/${shortName}/i`,
        actionLine: `await page.getByRole('${r}', { name: /${rxSrc}/i }).click();`,
        trustedWithoutProbe: false,
        preferredFallback: preferRole,
        rank: preferRole ? 88 : 40,
        locate: (p) => p.getByRole(role as 'button', { name: rx }),
      });
    }
  }

  // Label association (form fields + labelled controls).
  const clickLabel = (payload.labelText || payload.ariaLabel || '').trim();
  if (clickLabel && !isMegaText(clickLabel)) {
    const rxSrc = nameRegexSource(clickLabel);
    const rx = new RegExp(escapeRegexPattern(stableName(clickLabel)), 'i');
    out.push({
      detail: `label~/${stableName(clickLabel)}/i`,
      actionLine: `await page.getByLabel(/${rxSrc}/i).click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 86,
      locate: (p) => p.getByLabel(rx),
    });
  }

  if (payload.name) {
    const sel = `${tag}[name="${escapeIdent(payload.name)}"]`;
    out.push({
      detail: sel,
      actionLine: `await page.locator('${sel}').click();`,
      trustedWithoutProbe: true,
      rank: 84,
      locate: (p) => p.locator(`${tag}[name="${payload.name}"]`),
    });
  }

  if (payload.placeholder && !isMegaText(payload.placeholder)) {
    const ph = payload.placeholder;
    const rxSrc = nameRegexSource(ph);
    const rx = new RegExp(escapeRegexPattern(stableName(ph)), 'i');
    out.push({
      detail: `placeholder~/${stableName(ph)}/i`,
      actionLine: `await page.getByPlaceholder(/${rxSrc}/i).click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 80,
      locate: (p) => p.getByPlaceholder(rx),
    });
  }

  if (payload.className) {
    const already = new Set(pickBestCssClasses(payload.className, 2));
    const rest = String(payload.className)
      .trim()
      .split(/\s+/)
      .filter(
        (c) =>
          c &&
          isSafeCssClass(c) &&
          !CSS_UTILITY_CLASS.test(c) &&
          !already.has(c),
      );
    const first = rest[0];
    if (first) {
      const sel = `${tag}.${escapeIdent(first)}`;
      out.push({
        detail: sel,
        actionLine: `await page.locator('${sel}').click();`,
        trustedWithoutProbe: false,
        preferredFallback: false,
        rank: 28,
        locate: (p) => p.locator(`${tag}.${first}`),
      });
    }
  }

  if (shortName && !role) {
    const rxSrc = nameRegexSource(shortName);
    const rx = new RegExp(escapeRegexPattern(shortName), 'i');
    out.push({
      detail: `text~/${shortName}/i`,
      actionLine: `await page.getByText(/${rxSrc}/i).click();`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 75,
      locate: (p) => p.getByText(rx),
    });
  }

  if (payload.cssPath) {
    const path = payload.cssPath;
    out.push({
      detail: `cssPath`,
      actionLine: `await page.locator(${JSON.stringify(path)}).click();`,
      trustedWithoutProbe: false,
      rank: 15,
      locate: (p) => p.locator(path),
    });
  }

  // Last resort: replay viewport coordinates from capture time.
  if (
    typeof payload.clientX === 'number' &&
    typeof payload.clientY === 'number' &&
    Number.isFinite(payload.clientX) &&
    Number.isFinite(payload.clientY)
  ) {
    const x = Math.round(payload.clientX);
    const y = Math.round(payload.clientY);
    out.push({
      detail: `mouse(${x},${y})`,
      actionLine: `await page.mouse.click(${x}, ${y});`,
      trustedWithoutProbe: false,
      preferredFallback: false,
      rank: 8,
      locate: (p) => p.locator('body'),
    });
  }

  return applyFrameScope(payload, out);
}

/** Ranked fill locator candidates. Priority: id → accessible name → cssPath. */
function buildFillCandidates(payload: ElementPayload): LocatorCandidate[] {
  const out: LocatorCandidate[] = [];
  const value = String(payload.value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
  const tag = (payload.tagName || 'input').toLowerCase();
  const role = implicitRole(payload.tagName, payload.typeAttr, payload.role);

  if (payload.testId) {
    const id = payload.testId;
    out.push({
      detail: `testid=${id}`,
      actionLine: `await page.getByTestId('${escapeStr(id)}').fill('${value}');`,
      trustedWithoutProbe: true,
      rank: 100,
      locate: (p) => p.getByTestId(id),
    });
  }

  if (isStableId(payload.id)) {
    const sel = `#${escapeIdent(payload.id)}`;
    out.push({
      detail: sel,
      actionLine: `await page.locator('${sel}').fill('${value}');`,
      trustedWithoutProbe: true,
      rank: 95,
      locate: (p) => p.locator(`#${payload.id}`),
    });
  }

  pushDialogScopedFillCandidates(payload, out, value);

  const label = (payload.labelText || payload.ariaLabel || '').trim();
  if (label && !isMegaText(label)) {
    const rxSrc = nameRegexSource(label);
    const rx = new RegExp(escapeRegexPattern(stableName(label)), 'i');
    out.push({
      detail: `label~/${stableName(label)}/i`,
      actionLine: `await page.getByLabel(/${rxSrc}/i).fill('${value}');`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 88,
      locate: (p) => p.getByLabel(rx),
    });
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
      out.push({
        detail: `role=${role} name~/${stableName(label)}/i`,
        actionLine: `await page.getByRole('${escapeStr(role)}', { name: /${rxSrc}/i }).fill('${value}');`,
        trustedWithoutProbe: false,
        preferredFallback: true,
        rank: 87,
        locate: (p) => p.getByRole(role as 'textbox', { name: rx }),
      });
    }
  }

  if (payload.name) {
    const sel = `${tag}[name="${escapeIdent(payload.name)}"]`;
    out.push({
      detail: sel,
      actionLine: `await page.locator('${sel}').fill('${value}');`,
      trustedWithoutProbe: true,
      rank: 84,
      locate: (p) => p.locator(`${tag}[name="${payload.name}"]`),
    });
  }

  if (payload.placeholder && !isMegaText(payload.placeholder)) {
    const ph = payload.placeholder;
    const rxSrc = nameRegexSource(ph);
    const rx = new RegExp(escapeRegexPattern(stableName(ph)), 'i');
    if (payload.contentEditable) {
      const sel = `[data-placeholder="${escapeIdent(ph)}"]`;
      out.push({
        detail: `data-placeholder=${stableName(ph)}`,
        actionLine: `await page.locator('${sel}').fill('${value}');`,
        trustedWithoutProbe: true,
        preferredFallback: true,
        rank: 80,
        locate: (p) => p.locator(`[data-placeholder="${ph}"]`),
      });
    }
    out.push({
      detail: `placeholder~/${stableName(ph)}/i`,
      actionLine: `await page.getByPlaceholder(/${rxSrc}/i).fill('${value}');`,
      trustedWithoutProbe: false,
      preferredFallback: true,
      rank: 78,
      locate: (p) => p.getByPlaceholder(rx),
    });
  }

  if (payload.cssPath) {
    const path = payload.cssPath;
    out.push({
      detail: `cssPath`,
      actionLine: `await page.locator(${JSON.stringify(path)}).fill('${value}');`,
      trustedWithoutProbe: false,
      rank: 15,
      locate: (p) => p.locator(path),
    });
  }

  return applyFrameScope(payload, out);
}

/** Native <select>: Playwright fill() cannot set these — emit selectOption. */
function buildSelectOptionCandidates(payload: ElementPayload): LocatorCandidate[] {
  return buildFillCandidates({ ...payload, type: 'fill' }).map((c) => ({
    ...c,
    actionLine: c.actionLine.replace(/\.fill\(/g, '.selectOption('),
  }));
}

function isCheckControl(payload: ElementPayload): boolean {
  const typeAttr = (payload.typeAttr || '').toLowerCase();
  const role = implicitRole(payload.tagName, payload.typeAttr, payload.role);
  return (
    typeAttr === 'checkbox' ||
    typeAttr === 'radio' ||
    role === 'checkbox' ||
    role === 'radio' ||
    role === 'switch'
  );
}

/** Checkbox / radio: Playwright fill() cannot toggle these — emit check/uncheck. */
function buildCheckCandidates(
  payload: ElementPayload,
  action: 'check' | 'uncheck',
): LocatorCandidate[] {
  const fromFill = buildFillCandidates({ ...payload, type: 'fill' }).map((c) => ({
    ...c,
    actionLine: c.actionLine.replace(/\.fill\([^)]*\)/, `.${action}()`),
  }));
  const fromClick = buildClickCandidates({ ...payload, type: 'click' })
    .filter((c) => !isMouseActionLine(c.actionLine))
    .map((c) => ({
      ...c,
      actionLine: c.actionLine.replace(/\.click\(\)/, `.${action}()`),
    }));
  return [...fromFill, ...fromClick];
}

/**
 * Collect all candidates that resolve to the stamped element, ranked best-first.
 * Unique matches rank above nth()-disambiguated ones.
 */
async function pickVerifiedCandidates(
  page: Page,
  probeId: string,
  candidates: LocatorCandidate[],
): Promise<LocatorCandidate[]> {
  const uniqueHits: LocatorCandidate[] = [];
  const nthHits: LocatorCandidate[] = [];

  for (const candidate of candidates) {
    // Mouse replay cannot be probe-verified against a locator count.
    if (isMouseActionLine(candidate.actionLine)) continue;
    try {
      const loc = candidate.locate(page);
      const count = await loc.count();
      if (count === 0) continue;

      const limit = Math.min(count, 25);
      for (let i = 0; i < limit; i++) {
        const matches = await loc
          .nth(i)
          .evaluate((el, id) => el.getAttribute(PROBE_ATTR) === id, probeId)
          .catch(() => false);
        if (!matches) continue;

        if (count === 1) {
          uniqueHits.push(candidate);
        } else {
          nthHits.push({
            ...candidate,
            detail: `${candidate.detail} nth=${i}`,
            actionLine: withNth(candidate.actionLine, i),
            rank: Math.max(0, (candidate.rank || 0) - 5),
          });
        }
        break;
      }
    } catch {
      // try next candidate
    }
  }

  const dedupe = (list: LocatorCandidate[]) => {
    const seen = new Set<string>();
    const out: LocatorCandidate[] = [];
    for (const c of [...list].sort(rankSort)) {
      if (seen.has(c.actionLine)) continue;
      seen.add(c.actionLine);
      out.push(c);
    }
    return out;
  };

  return [...dedupe(uniqueHits), ...dedupe(nthHits)];
}

/** @deprecated use pickVerifiedCandidates — kept for single-best callers */
async function pickVerifiedCandidate(
  page: Page,
  probeId: string,
  candidates: LocatorCandidate[],
): Promise<LocatorCandidate | null> {
  const all = await pickVerifiedCandidates(page, probeId, candidates);
  return all[0] || null;
}

function clearProbe(page: Page, probeId?: string, frameSelector?: string) {
  if (!probeId) return Promise.resolve();
  const root = frameSelector ? page.frameLocator(frameSelector) : page;
  return root
    .locator(`[${PROBE_ATTR}=${JSON.stringify(probeId)}]`)
    .evaluate((el) => el.removeAttribute(PROBE_ATTR))
    .catch(() => undefined);
}

function buildFallbackBundle(
  candidates: LocatorCandidate[],
  verified: LocatorCandidate[],
): LocatorCandidate[] {
  const seen = new Set(verified.map((c) => c.actionLine));
  const extras = [...candidates]
    .sort(rankSort)
    .filter(
      (c) =>
        !seen.has(c.actionLine) &&
        !isMouseActionLine(c.actionLine) &&
        (c.trustedWithoutProbe ||
          c.preferredFallback ||
          (c.rank || 0) >= 70),
    );
  const bundle = [...verified, ...extras];
  const out: LocatorCandidate[] = [];
  const lines = new Set<string>();
  for (const c of bundle) {
    if (lines.has(c.actionLine)) continue;
    lines.add(c.actionLine);
    out.push(c);
    if (out.length >= HEAL_BUNDLE_MAX - 1) break;
  }
  // Always keep mouse replay as the final safety net when captured.
  const mouse = candidates.find((c) => isMouseActionLine(c.actionLine));
  if (mouse && !lines.has(mouse.actionLine) && out.length < HEAL_BUNDLE_MAX) {
    out.push(mouse);
  }
  // If nothing else matched, still return top-ranked candidates.
  if (!out.length) {
    for (const c of [...candidates].sort(rankSort)) {
      if (lines.has(c.actionLine)) continue;
      lines.add(c.actionLine);
      out.push(c);
      if (out.length >= HEAL_BUNDLE_MAX) break;
    }
  }
  return out;
}

/**
 * Same-element guarantee: verify locators against the probe when possible.
 * Emit a self-healing bundle (ranked fallbacks) for clicks so wrong first
 * guesses still succeed when the UI is unchanged.
 */
async function resolveVerifiedAction(
  page: Page,
  payload: ElementPayload,
): Promise<{ lines: string[]; detail: string; role?: string } | null> {
  // File inputs: never record a normal click/fill — emit setInputFiles.
  if (
    (payload.tagName || '').toLowerCase() === 'input' &&
    (payload.typeAttr || '').toLowerCase() === 'file'
  ) {
    const candidates = buildFillCandidates({ ...payload, type: 'fill' });
    let chosen =
      (payload.probeId && (await pickVerifiedCandidate(page, payload.probeId, candidates))) ||
      candidates.find((c) => c.preferredFallback || c.trustedWithoutProbe) ||
      candidates[0];
    if (!chosen && payload.cssPath) {
      chosen = {
        detail: 'cssPath',
        actionLine: `await page.locator(${JSON.stringify(payload.cssPath)}).fill('');`,
        trustedWithoutProbe: false,
        locate: (p) => p.locator(payload.cssPath!),
      };
    }
    if (!chosen) return null;
    const setLine = chosen.actionLine
      .replace(/\.fill\([^)]*\)/, `.setInputFiles('${FILE_PATH_PLACEHOLDER}')`)
      .replace(/\.click\(\)/, `.setInputFiles('${FILE_PATH_PLACEHOLDER}')`);
    return {
      lines: [setLine],
      detail: `setInputFiles (edit path: ${FILE_PATH_PLACEHOLDER})`,
      role: 'textbox',
    };
  }

  if (!isActionablePayload(payload)) {
    return null;
  }

  const role = implicitRole(payload.tagName, payload.typeAttr, payload.role);
  const isNativeSelect = (payload.tagName || '').toLowerCase() === 'select';
  const wantsSelectOption =
    payload.type === 'selectOption' ||
    (isNativeSelect && (payload.type === 'fill' || payload.type === 'press'));
  const checkAction: 'check' | 'uncheck' | null = isCheckControl(payload)
    ? payload.type === 'uncheck' || payload.checked === false
      ? 'uncheck'
      : 'check'
    : null;
  // Press reuses fill locators (same field), then swaps .fill → .press.
  // Native <select> must use selectOption — Playwright fill() rejects them.
  const candidates =
    checkAction && payload.type !== 'press'
      ? buildCheckCandidates(payload, checkAction)
      : wantsSelectOption
        ? buildSelectOptionCandidates(payload)
        : payload.type === 'fill' || payload.type === 'press'
          ? buildFillCandidates(payload)
          : buildClickCandidates(payload);

  let verified: LocatorCandidate[] = [];
  if (payload.probeId && candidates.length) {
    verified = await pickVerifiedCandidates(page, payload.probeId, candidates);
  }

  const bundle = buildFallbackBundle(candidates, verified);
  if (!bundle.length) {
    return null;
  }

  const lines: string[] = [];
  const top = bundle[0];
  let detail = `${payload.type} ${top.detail}${payload.probeId ? ' (verified)' : ''}`;
  if (bundle.length > 1) {
    detail += ` +heal×${bundle.length}`;
  }

  // Hover menu opener before clicking the item.
  if (payload.type === 'click' && payload.hoverParentName && !isMegaText(payload.hoverParentName)) {
    const hRx = nameRegexSource(payload.hoverParentName);
    const hRole = escapeStr(payload.hoverParentRole || 'button');
    lines.push(
      `await page.getByRole('${hRole}', { name: /${hRx}/i }).first().hover();`,
    );
    detail += ' + hover parent';
  }

  // New-tab clicks: keep a single strongest locator (Promise.all wrap is simpler).
  if (payload.type === 'click' && payload.targetBlank) {
    lines.push(wrapNewTabClick(top.actionLine));
    detail += ' + new tab';
  } else if (checkAction && payload.type !== 'press') {
    lines.push(...composeHealActionLines(bundle, checkAction));
    detail = detail.replace(/^(click|fill|check|uncheck) /, `${checkAction} `);
  } else if (payload.type === 'fill' && wantsSelectOption) {
    lines.push(
      ...composeHealActionLines(bundle, 'selectOption', String(payload.value ?? '')),
    );
    detail = detail.replace(/^fill /, 'selectOption ');
  } else if (payload.type === 'selectOption' || (wantsSelectOption && payload.type !== 'press')) {
    lines.push(
      ...composeHealActionLines(bundle, 'selectOption', String(payload.value ?? '')),
    );
    detail = detail.replace(/^(click|fill|selectOption) /, 'selectOption ');
  } else if (payload.type === 'fill') {
    lines.push(
      ...composeHealActionLines(bundle, 'fill', String(payload.value ?? '')),
    );
  } else if (payload.type === 'press') {
    const pressKey = payload.key || 'Enter';
    // Flush the typed value first — change often has not fired yet on Enter.
    const fillValue = String(payload.value ?? '');
    if (fillValue) {
      lines.push(...composeHealActionLines(bundle, 'fill', fillValue));
      detail += ' + fill';
    }
    const pressBundle = toPressCandidates(bundle, pressKey);
    lines.push(...composeHealActionLines(pressBundle, 'press', undefined, pressKey));
  } else {
    lines.push(...composeHealActionLines(bundle, 'click'));
  }

  if (payload.type === 'click' && role === 'tab') {
    const shortName = pickShortName(payload);
    if (shortName) {
      const rxSrc = nameRegexSource(shortName);
      lines.push(
        `await expect(page.getByRole('tab', { name: /${rxSrc}/i })).toHaveAttribute('aria-selected', 'true');`,
      );
      detail += ' + assert tab selected';
    }
  }

  try {
    // eslint-disable-next-line no-new
    new AsyncFunction('page', 'expect', 'context', lines.join('\n'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Capture script parse failed: ${message}`);
    const semantic =
      verified[0] ||
      [...candidates]
        .sort(rankSort)
        .find((c) => c.preferredFallback || c.trustedWithoutProbe);
    if (semantic) {
      return { lines: [semantic.actionLine], detail: `${semantic.detail} (parse-safe)`, role };
    }
    return null;
  }

  return { lines, detail, role };
}

/**
 * Injected into the page under test: resolve target, stamp probe, send payload to Electron.
 */
function installDomCapture() {
  const PROBE = 'data-at-probe';

  const send = (payload: Record<string, unknown>) => {
    // @ts-expect-error injected bridge
    if (typeof window.__autoTesterCapture === 'function') {
      // @ts-expect-error injected bridge
      return window.__autoTesterCapture(payload);
    }
  };

  const cleanText = (raw: string | null | undefined) =>
    String(raw || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

  const isEphemeralId = (id?: string | null) => {
    if (!id) return true;
    const v = id.trim();
    if (!v) return true;
    if (v.includes(':')) return true;
    return /^(_r_|_r-|:r|radix-|mui-|react-|ember\d)/i.test(v);
  };

  const labelFor = (el: HTMLElement): string | undefined => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .map((t) => cleanText(t))
        .filter(Boolean);
      if (parts.length) return parts.join(' ');
    }
    if (el.id && !isEphemeralId(el.id)) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const t = cleanText(lab?.textContent);
        if (t) return t;
      } catch {
        /* ignore */
      }
    }
    const parentLabel = el.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('input, textarea, select, button').forEach((n) => n.remove());
      const t = cleanText(clone.textContent);
      if (t) return t;
    }
    // Sibling / nearby label (common "First Name" + input patterns without htmlFor).
    let sib = el.previousElementSibling as HTMLElement | null;
    while (sib) {
      const tag = sib.tagName.toLowerCase();
      if (tag === 'label') {
        const t = cleanText(sib.textContent);
        if (t) return t;
      }
      if (['input', 'textarea', 'select', 'button'].includes(tag)) break;
      sib = sib.previousElementSibling as HTMLElement | null;
    }
    const parent = el.parentElement;
    if (parent) {
      const directLab = parent.querySelector(':scope > label');
      if (directLab && !directLab.contains(el)) {
        const t = cleanText(directLab.textContent);
        if (t) return t;
      }
    }
    return undefined;
  };

  /**
   * Only real controls — never fall back to form/div/main wrappers.
   * Accidental clicks on empty layout are ignored.
   */
  const resolveClickTarget = (el: Element): HTMLElement | null => {
    if (el.closest('[data-at-select-overlay], [data-auto-tester-overlay]')) return null;
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const htmlFor = wrappingLabel.getAttribute('for');
      let control: HTMLElement | null = null;
      if (htmlFor) {
        try {
          control = document.getElementById(htmlFor);
        } catch {
          control = null;
        }
      }
      if (!control) {
        control = wrappingLabel.querySelector(
          'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [contenteditable=""]',
        ) as HTMLElement | null;
      }
      if (control) return control;
    }
    const interactive = el.closest(
      [
        'button',
        'a',
        'summary',
        'input',
        'select',
        'textarea',
        'option',
        '[contenteditable="true"]',
        '[contenteditable=""]',
        '[role="button"]',
        '[role="tab"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="switch"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="treeitem"]',
        '[role="textbox"]',
        '[role="searchbox"]',
        '[aria-haspopup]',
      ].join(', '),
    ) as HTMLElement | null;
    if (
      interactive &&
      interactive.tagName.toLowerCase() === 'input' &&
      (interactive as HTMLInputElement).type === 'hidden'
    ) {
      return null;
    }
    if (interactive) return interactive;
    let node: HTMLElement | null = el instanceof HTMLElement ? el : el.parentElement;
    for (let depth = 0; depth < 4 && node; depth++) {
      const boxes = Array.from(
        node.querySelectorAll('input[type="checkbox"], input[type="radio"]'),
      ) as HTMLInputElement[];
      if (boxes.length === 1) return boxes[0];
      if (boxes.length > 1) break;
      node = node.parentElement;
    }
    return null;
  };

  /** Unique-enough CSS path; never anchors on ephemeral React ids. */
  const cssPathFor = (el: HTMLElement): string => {
    if (el.id && !isEphemeralId(el.id)) return `#${CSS.escape(el.id)}`;
    const parts: string[] = [];
    let node: HTMLElement | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      if (node.id && !isEphemeralId(node.id)) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      const testId =
        node.getAttribute('data-testid') || node.getAttribute('data-test-id');
      if (testId) {
        parts.unshift(`[data-testid="${CSS.escape(testId)}"]`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => (c as HTMLElement).tagName === node!.tagName,
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(node) + 1;
          part += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
      if (node && (node.tagName === 'BODY' || node.tagName === 'HTML')) break;
    }
    return parts.join(' > ');
  };

  /** First meaningful cell text in the row (property name, etc.) — skips icon-only cells. */
  const rowNameFor = (el: HTMLElement): string | undefined => {
    const row = el.closest('tr, [role="row"]') as HTMLElement | null;
    if (!row) return undefined;
    if (row.closest('thead')) return undefined;

    const cells = Array.from(
      row.querySelectorAll(
        ':scope > td, :scope > th, :scope > [role="cell"], :scope > [role="gridcell"]',
      ),
    ) as HTMLElement[];

    const candidates: string[] = [];
    for (const cell of cells) {
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('button, a, svg, input, select, textarea').forEach((n) => n.remove());
      const t = cleanText(clone.textContent);
      if (!t || t.length < 2) continue;
      if (t.length > 60) continue;
      if (/^[\d.,%$]+$/.test(t)) continue; // skip pure numeric cells
      candidates.push(t.slice(0, 48));
    }
    // Prefer stable codes like CPMS0008 over long display names.
    const code = candidates.find((t) => /^[A-Z]{2,}\d{2,}$/i.test(t.replace(/\s+/g, '')));
    if (code) return code.replace(/\s+/g, '');
    return candidates[0];
  };

  /**
   * Short field label for controls inside a wrapping <label> (Zone Clear, Status Clear).
   * Takes the first meaningful word so hasText: /Zone/i scopes correctly.
   */
  const fieldGroupNameFor = (el: HTMLElement): string | undefined => {
    const parentLabel = el.closest('label') as HTMLElement | null;
    if (!parentLabel) return undefined;
    const clone = parentLabel.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll('button, input, select, textarea, svg, [role="button"]')
      .forEach((n) => n.remove());
    const t = cleanText(clone.textContent);
    if (!t || t.length < 2) return undefined;
    const first = t
      .split(/\s+/)
      .map((w) => w.replace(/[▾▼▼]+/g, '').trim())
      .find((w) => w.length >= 2);
    if (!first || first.length > 40) return undefined;
    return first.slice(0, 32);
  };

  const rowMetaFor = (el: HTMLElement) => {
    const row = el.closest('tr, [role="row"]') as HTMLElement | null;
    if (!row || row.closest('thead')) {
      return { rowSelector: undefined as string | undefined, actionIndexInRow: undefined as number | undefined };
    }
    const rowSelector =
      row.tagName.toLowerCase() === 'tr'
        ? 'tr'
        : row.getAttribute('role') === 'row'
          ? '[role="row"]'
          : 'tr';
    const actions = Array.from(
      row.querySelectorAll('a, button, [role="button"]'),
    ) as HTMLElement[];
    let actionIndexInRow: number | undefined;
    const direct = actions.indexOf(el);
    if (direct >= 0) actionIndexInRow = direct;
    else {
      const wrapped = actions.findIndex((a) => a.contains(el) || el.contains(a));
      if (wrapped >= 0) actionIndexInRow = wrapped;
    }
    return { rowSelector, actionIndexInRow };
  };

  const dialogContextFor = (el: HTMLElement) => {
    const dialog = el.closest(
      '[role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .MuiModal-root, [data-state="open"][role="dialog"]',
    ) as HTMLElement | null;
    if (!dialog) return { inDialog: false as const };
    const labelledBy = dialog.getAttribute('aria-labelledby');
    let name =
      cleanText(dialog.getAttribute('aria-label')) ||
      (labelledBy
        ? cleanText(document.getElementById(labelledBy)?.textContent)
        : undefined);
    if (!name) {
      const heading = dialog.querySelector('h1, h2, h3, [role="heading"]');
      name = cleanText(heading?.textContent) || undefined;
    }
    if (name && name.length > 48) name = name.slice(0, 48);
    return { inDialog: true as const, dialogName: name || undefined };
  };

  const hoverParentFor = (el: HTMLElement) => {
    const roleAttr = el.getAttribute('role') || '';
    const inListbox = el.closest('[role="listbox"], [role="combobox"]');
    const inMenu = el.closest('[role="menu"]');

    // Select options are revealed by clicking their trigger, not by hover.
    if (roleAttr === 'option' || inListbox) {
      return {};
    }

    if (roleAttr !== 'menuitem' && !inMenu) {
      return {};
    }
    const menu = (inMenu || el.closest('[role="menu"]')) as HTMLElement | null;
    let opener: HTMLElement | null = null;
    if (menu?.id) {
      try {
        opener = document.querySelector(
          `[aria-controls="${CSS.escape(menu.id)}"]`,
        ) as HTMLElement | null;
      } catch {
        /* ignore */
      }
    }
    if (!opener) {
      opener = document.querySelector(
        '[aria-haspopup][aria-expanded="true"]',
      ) as HTMLElement | null;
    }
    if (!opener || opener.contains(el)) return {};
    const name = (
      cleanText(opener.getAttribute('aria-label')) ||
      cleanText(opener.innerText || opener.textContent) ||
      undefined
    )
      ?.replace(/[▾▼]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!name || name.length < 2) return {};
    const openerRole = opener.getAttribute('role') || undefined;
    let hoverParentRole = openerRole;
    if (!hoverParentRole) {
      const tag = opener.tagName.toLowerCase();
      if (tag === 'button' || tag === 'summary') hoverParentRole = 'button';
      else if (tag === 'a') hoverParentRole = 'link';
      else hoverParentRole = 'button';
    }
    return {
      hoverParentName: name.slice(0, 48),
      hoverParentRole,
    };
  };

  const frameSelectorFor = (el: HTMLElement): string | undefined => {
    try {
      const view = el.ownerDocument?.defaultView;
      if (!view || view === window.top) return undefined;
      // Inside an iframe document — describe the frame element in the parent if possible.
      const frameEl = view.frameElement as HTMLIFrameElement | null;
      if (!frameEl) return 'iframe';
      if (frameEl.name) return `iframe[name="${frameEl.name}"]`;
      const title = frameEl.getAttribute('title');
      if (title) return `iframe[title="${title}"]`;
      const src = frameEl.getAttribute('src');
      if (src) {
        try {
          const path = new URL(src, location.href).pathname;
          return `iframe[src*="${path.split('/').filter(Boolean).pop() || path}"]`;
        } catch {
          return `iframe[src="${src}"]`;
        }
      }
      return 'iframe';
    } catch {
      return undefined;
    }
  };

  const describe = (el: HTMLElement) => {
    const input = el as HTMLInputElement;
    const anchor = el.closest('a') as HTMLAnchorElement | null;
    const isEditable =
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true' ||
      el.getAttribute('contenteditable') === '';
    const roleAttr = el.getAttribute('role') || (isEditable ? 'textbox' : undefined);
    const isOptionLike =
      roleAttr === 'option' ||
      roleAttr === 'menuitem' ||
      roleAttr === 'treeitem';
    const text = isEditable ? undefined : cleanText(el.innerText || el.textContent);
    const href =
      (el.tagName.toLowerCase() === 'a' ? el.getAttribute('href') : null) ||
      anchor?.getAttribute('href') ||
      undefined;
    const stableId = el.id && !isEphemeralId(el.id) ? el.id : undefined;
    const rowName = rowNameFor(el);
    const rowMeta = rowMetaFor(el);
    const dialog = dialogContextFor(el);
    const hover = hoverParentFor(el);
    const targetBlank =
      el.getAttribute('target') === '_blank' ||
      anchor?.getAttribute('target') === '_blank' ||
      undefined;
    const inNav = !!(
      el.closest('nav, [role="navigation"]') || undefined
    );
    return {
      tagName: el.tagName,
      id: stableId,
      name: input.name || undefined,
      testId:
        el.getAttribute('data-testid') ||
        el.getAttribute('data-test-id') ||
        undefined,
      typeAttr: input.type || undefined,
      className: typeof el.className === 'string' ? el.className : undefined,
      role: roleAttr,
      text: text || undefined,
      ariaLabel: cleanText(el.getAttribute('aria-label')) || undefined,
      title: cleanText(el.getAttribute('title')) || undefined,
      placeholder:
        cleanText(input.placeholder) ||
        cleanText(el.getAttribute('data-placeholder')) ||
        cleanText(el.getAttribute('aria-placeholder')) ||
        undefined,
      labelText: isOptionLike ? undefined : labelFor(el),
      contentEditable: isEditable || undefined,
      href: href || undefined,
      ariaHasPopup: el.getAttribute('aria-haspopup') || undefined,
      rowName: rowName || undefined,
      rowSelector: rowMeta.rowSelector,
      actionIndexInRow: rowMeta.actionIndexInRow,
      fieldGroupName: fieldGroupNameFor(el),
      inDialog: dialog.inDialog || undefined,
      dialogName: dialog.dialogName,
      inNav: inNav || undefined,
      hoverParentName: hover.hoverParentName,
      hoverParentRole: hover.hoverParentRole,
      frameSelector: frameSelectorFor(el),
      targetBlank: targetBlank || undefined,
      cssPath: cssPathFor(el),
    };
  };

  const stampAndDescribe = (el: HTMLElement) => {
    const probeId = `at-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    el.setAttribute(PROBE, probeId);
    return { ...describe(el), probeId };
  };

  if ((window as unknown as { __atCaptureBound?: boolean }).__atCaptureBound) return;
  (window as unknown as { __atCaptureBound?: boolean }).__atCaptureBound = true;

  const SELECT_OVERLAY = 'data-at-select-overlay';
  const removeSelectOverlay = () => {
    document.querySelectorAll(`[${SELECT_OVERLAY}]`).forEach((node) => node.remove());
  };
  /**
   * Native <select> popups are OS chrome — headless CDP screencast never shows them.
   * Draw an in-page option list so capture/run Preview can pick a value.
   */
  const showSelectOverlay = (select: HTMLSelectElement) => {
    removeSelectOverlay();
    const rect = select.getBoundingClientRect();
    const overlay = document.createElement('div');
    overlay.setAttribute(SELECT_OVERLAY, 'menu');
    Object.assign(overlay.style, {
      position: 'fixed',
      left: `${Math.max(8, rect.left)}px`,
      top: `${rect.bottom + 4}px`,
      minWidth: `${Math.max(rect.width, 160)}px`,
      maxHeight: '240px',
      overflowY: 'auto',
      background: '#1f2937',
      color: '#f9fafb',
      borderRadius: '8px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
      zIndex: '2147483647',
      padding: '4px 0',
      font: '14px/1.4 system-ui, sans-serif',
    });
    Array.from(select.options).forEach((opt, index) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.setAttribute(SELECT_OVERLAY, 'option');
      row.textContent = (opt.textContent || opt.value || `Option ${index + 1}`).trim();
      Object.assign(row.style, {
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '8px 12px',
        border: '0',
        background: opt.selected ? '#2563eb' : 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      });
      row.addEventListener('mouseenter', () => {
        if (!opt.selected) row.style.background = '#374151';
      });
      row.addEventListener('mouseleave', () => {
        row.style.background = opt.selected ? '#2563eb' : 'transparent';
      });
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        select.value = opt.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        removeSelectOverlay();
      });
      overlay.appendChild(row);
    });
    document.documentElement.appendChild(overlay);
    const box = overlay.getBoundingClientRect();
    if (box.bottom > window.innerHeight - 8) {
      overlay.style.top = `${Math.max(8, rect.top - box.height - 4)}px`;
    }
    if (box.right > window.innerWidth - 8) {
      overlay.style.left = `${Math.max(8, window.innerWidth - box.width - 8)}px`;
    }
  };

  let lastEditableSent = '';
  const sendEditableFill = (el: HTMLElement) => {
    const value = String(el.innerText || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+\n/g, '\n')
      .trim();
    if (!value || value === lastEditableSent) return;
    lastEditableSent = value;
    void send({
      type: 'fill',
      ...stampAndDescribe(el),
      value,
    });
  };

  let editableTimer: number | undefined;

  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as Element | null;
      if (!t || !(t instanceof Element)) return;
      if (t.closest(`[${SELECT_OVERLAY}]`)) return;
      const target = resolveClickTarget(t);
      if (target && target.tagName.toLowerCase() === 'select') {
        showSelectOverlay(target as HTMLSelectElement);
        return;
      }
      removeSelectOverlay();
      if (!target) return;
      // File inputs: wait for change → setInputFiles (skip raw click).
      if (
        target.tagName.toLowerCase() === 'input' &&
        (target as HTMLInputElement).type === 'file'
      ) {
        return;
      }
      // Checkbox / radio: wait until the native toggle applies, then record check().
      if (
        target.tagName.toLowerCase() === 'input' &&
        ['checkbox', 'radio'].includes((target as HTMLInputElement).type || '')
      ) {
        const box = target as HTMLInputElement;
        if (!t.closest('input, label')) {
          box.checked = !box.checked;
          box.dispatchEvent(new Event('input', { bubbles: true }));
          box.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        queueMicrotask(() => {
          void send({
            type: box.checked ? 'check' : 'uncheck',
            ...stampAndDescribe(box),
            typeAttr: box.type,
            checked: box.checked,
            value: box.value,
          });
        });
        return;
      }
      // Contenteditable: wait for input/blur → fill (skip raw click).
      if (
        target.isContentEditable ||
        target.getAttribute('contenteditable') === 'true' ||
        target.getAttribute('contenteditable') === ''
      ) {
        return;
      }
      void send({
        type: 'click',
        ...stampAndDescribe(target),
        clientX: typeof e.clientX === 'number' ? e.clientX : undefined,
        clientY: typeof e.clientY === 'number' ? e.clientY : undefined,
      });
    },
    true,
  );

  document.addEventListener(
    'change',
    (e) => {
      const t = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!t || !('value' in t)) return;
      const tag = t.tagName.toLowerCase();
      const typeAttr = (t as HTMLInputElement).type || undefined;
      const isCheck = typeAttr === 'checkbox' || typeAttr === 'radio';
      const checked = isCheck ? Boolean((t as HTMLInputElement).checked) : undefined;
      void send({
        type:
          typeAttr === 'file'
            ? 'setInputFiles'
            : tag === 'select'
              ? 'selectOption'
              : isCheck
                ? checked
                  ? 'check'
                  : 'uncheck'
                : 'fill',
        ...stampAndDescribe(t as HTMLElement),
        value: t.value,
        typeAttr,
        checked,
      });
    },
    true,
  );

  document.addEventListener(
    'input',
    (e) => {
      const t = e.target as Element | null;
      if (!t || !(t instanceof HTMLElement)) return;
      const editable = t.closest(
        '[contenteditable="true"], [contenteditable=""]',
      ) as HTMLElement | null;
      if (!editable) return;
      window.clearTimeout(editableTimer);
      editableTimer = window.setTimeout(() => sendEditableFill(editable), 450);
    },
    true,
  );

  document.addEventListener(
    'focusout',
    (e) => {
      const t = e.target as Element | null;
      if (!t || !(t instanceof HTMLElement)) return;
      const editable = t.closest(
        '[contenteditable="true"], [contenteditable=""]',
      ) as HTMLElement | null;
      if (!editable) return;
      window.clearTimeout(editableTimer);
      sendEditableFill(editable);
    },
    true,
  );

  /**
   * Search boxes often submit on Enter (no search button click).
   * Record press('Enter'); Node side also flushes fill when value is set.
   */
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const t = e.target as Element | null;
      if (!t || !(t instanceof HTMLElement)) return;

      const tag = t.tagName.toLowerCase();
      const role = (t.getAttribute('role') || '').toLowerCase();
      const typeAttr =
        tag === 'input' ? ((t as HTMLInputElement).type || 'text').toLowerCase() : undefined;

      // Multi-line typing: Enter inserts a newline, not a submit.
      if (tag === 'textarea') return;
      if (t.isContentEditable) return;

      const isTextField =
        (tag === 'input' &&
          !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'hidden'].includes(
            typeAttr || '',
          )) ||
        role === 'searchbox' ||
        role === 'textbox' ||
        role === 'combobox';
      if (!isTextField) return;

      void send({
        type: 'press',
        key: 'Enter',
        ...stampAndDescribe(t),
        value: 'value' in t ? String((t as HTMLInputElement).value ?? '') : undefined,
        typeAttr,
      });
    },
    true,
  );
}

export class CaptureManager {
  private readonly sessions = new Map<string, CaptureSession>();

  /** Close every open capture browser so a new Start cannot stack orphan sessions. */
  private async closeAllSessions(): Promise<number> {
    const ids = [...this.sessions.keys()];
    for (const id of ids) {
      await this.stop(id).catch(() => undefined);
    }
    return ids.length;
  }

  /**
   * Run every step before untilNodeId, attach Preview, leave Chromium open.
   * Shared by action Capture and AI-script HTML capture. Loop nodes are skipped:
   * their scriptText is navigate-back for Run repeats, not a warm-up step.
   */
  private async warmupUntilNode(body: StartCaptureBody): Promise<{
    browser: Browser;
    context: BrowserContext;
    page: Page;
    url: string;
    warmedUpSteps: number;
  }> {
    if (!body.untilNodeId) {
      throw Object.assign(new Error('untilNodeId is required'), { status: 400 });
    }

    const url = (body.url?.trim() || body.projectUrl || '').trim();
    const nodes = (body.nodes || []) as FlowNode[];
    const edges = (body.edges || []) as FlowEdge[];
    const ordered = orderNodesByEdges(nodes, edges);
    const targetIndex = ordered.findIndex((n) => n.id === body.untilNodeId);
    if (targetIndex < 0) {
      throw Object.assign(
        new Error(`untilNodeId "${body.untilNodeId}" not found in flow graph`),
        { status: 400 },
      );
    }
    const warmupNodes = ordered
      .slice(0, targetIndex)
      .filter((node) => resolveNodeStepKind(node) !== 'loop');

    await this.closeAllSessions();

    const browser = await chromium.launch({ headless: true, slowMo: 40 });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      baseURL: body.projectUrl || url || undefined,
      ignoreHTTPSErrors: true,
    });
    let page = await context.newPage();
    await previewBridge.attach(page, { width: 1280, height: 720 });

    if (url) {
      await page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
        .catch(() => undefined);
    }

    for (const node of warmupNodes) {
      const kind = resolveNodeStepKind(node);
      const label = node.data?.label || node.id;

      let scriptText = '';
      try {
        scriptText = await resolveExecutableScript(page, node);
      } catch (err) {
        // AI fill with missing goal should fail warm-up; other resolve errors too.
        if (kind === 'aiFill') {
          await previewBridge.detach().catch(() => undefined);
          await browser.close().catch(() => undefined);
          const message = err instanceof Error ? err.message : String(err);
          throw Object.assign(
            new Error(`Warm-up failed on step "${label}": ${message}`),
            { status: 400 },
          );
        }
        console.warn(
          `Warm-up skip resolve on node ${node.id} (${label}): ${
            err instanceof Error ? err.message : err
          }`,
        );
        continue;
      }

      if (!scriptText) {
        if (kind === 'aiFill') {
          await previewBridge.detach().catch(() => undefined);
          await browser.close().catch(() => undefined);
          throw Object.assign(
            new Error(`AI fill step "${label}" has no saved script`),
            { status: 400 },
          );
        }
        if (kind !== 'inputWait') {
          console.warn(`Warm-up skip empty script on node ${node.id} (${label})`);
          continue;
        }
      } else {
        try {
          // Hard expect during warm-up — soft URL retries look like a hang/loop.
          const nextPage = await runPlaywrightScript(
            scriptText,
            context,
            page,
            () => undefined,
            false,
          );
          if (nextPage && nextPage !== page) {
            page = nextPage;
            await previewBridge.attach(page, { width: 1280, height: 720 }).catch(() => undefined);
          }
        } catch (err) {
          await previewBridge.detach().catch(() => undefined);
          await browser.close().catch(() => undefined);
          const message = err instanceof Error ? err.message : String(err);
          throw Object.assign(
            new Error(`Warm-up failed on step "${label}": ${message}`),
            { status: 400 },
          );
        }
      }

      // Prior inputWait: let the user finish OTP/captcha in Preview before continuing.
      if (kind === 'inputWait') {
        const reason =
          String(node.data?.description || '').trim() || label || 'human input';
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['Continue'],
          defaultId: 0,
          title: `Paused for ${reason}`,
          message: 'Please complete this and press Continue.',
        });
      }
    }

    return { browser, context, page, url, warmedUpSteps: warmupNodes.length };
  }

  /**
   * Warm-up prior steps, keep Preview on the page, and index interactive controls.
   * Recording stays off — this is not click/fill capture and does not store page HTML.
   */
  async captureHtml(body: StartCaptureBody): Promise<{
    sessionId: string;
    catalog: HtmlCatalogItem[];
    url: string;
    warmedUpSteps: number;
  }> {
    const { browser, page, url, warmedUpSteps } = await this.warmupUntilNode(body);
    const catalog = await listHtmlCatalog(page);
    if (!catalog.length) {
      await previewBridge.detach().catch(() => undefined);
      await browser.close().catch(() => undefined);
      throw Object.assign(new Error('Could not index page controls'), { status: 400 });
    }

    const sessionId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      browser,
      page,
      events: [],
      nextEventId: 1,
      lastPolledIdByClient: 0,
      recording: false,
      navWatchGeneration: 0,
    });
    console.log(
      `HTML capture ${sessionId}: warmed up ${warmedUpSteps} step(s), indexed ${catalog.length} control(s)`,
    );
    return { sessionId, catalog, url, warmedUpSteps };
  }

  /**
   * Slice live-page HTML for an AI-script goal. hint finds matches; pickedIds
   * extracts an already-narrowed set. Throws when the capture session is gone.
   */
  async sliceHtml(
    sessionId: string,
    body: { hint?: HtmlLocateHint; pickedIds?: string[] },
  ): Promise<HtmlSliceResult> {
    const session = this.sessions.get(sessionId);
    if (!session || session.page.isClosed()) {
      throw Object.assign(new Error('HTML capture session is no longer active'), {
        status: 404,
        code: 'SESSION_GONE',
      });
    }
    if (Array.isArray(body.pickedIds) && body.pickedIds.length) {
      const catalog = await listHtmlCatalog(session.page).catch(() => []);
      return sliceHtmlByIds(session.page, body.pickedIds, catalog);
    }
    if (!body.hint) {
      throw Object.assign(new Error('A locate hint or picked ids are required'), { status: 400 });
    }
    return sliceHtmlForHint(session.page, body.hint);
  }

  /**
   * Warm up prior steps and return normalized controls for AI-fill authoring.
   * The browser remains attached to Preview so the user can pick fields.
   */
  async captureFields(body: StartCaptureBody): Promise<{
    sessionId: string;
    formFound: boolean;
    fields: Awaited<ReturnType<typeof normalizePageFields>>['fields'];
    url: string;
    warmedUpSteps: number;
  }> {
    const { browser, page, url, warmedUpSteps } = await this.warmupUntilNode(body);
    const normalized = await normalizePageFields(page);
    const sessionId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      browser,
      page,
      events: [],
      nextEventId: 1,
      lastPolledIdByClient: 0,
      recording: false,
      navWatchGeneration: 0,
    });
    console.log(
      `AI-fill field capture ${sessionId}: found ${normalized.fields.length} field(s)`,
    );
    return { sessionId, ...normalized, url, warmedUpSteps };
  }

  /**
   * Warm up steps before the previous node, listen for xhr/fetch while that
   * node runs, and return the calls. Preview stays attached for inspection.
   */
  async captureApis(body: StartCaptureBody): Promise<{
    sessionId: string;
    apis: CapturedApiCall[];
    url: string;
    warmedUpSteps: number;
    previousStepLabel: string;
  }> {
    if (!body.untilNodeId) {
      throw Object.assign(new Error('untilNodeId is required'), { status: 400 });
    }
    const nodes = (body.nodes || []) as FlowNode[];
    const edges = (body.edges || []) as FlowEdge[];
    const ordered = orderNodesByEdges(nodes, edges);
    const previous = previousNonLoopNode(ordered, body.untilNodeId);
    if (!previous) {
      throw Object.assign(
        new Error('Add a previous step before capturing APIs.'),
        { status: 400 },
      );
    }
    const previousLabel = previous.data?.label || previous.id;
    let previousScript = '';
    try {
      previousScript = await resolveExecutableScript(null, previous);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(
        new Error(`Previous step "${previousLabel}" could not be prepared: ${message}`),
        { status: 400 },
      );
    }
    const previousKind = resolveNodeStepKind(previous);
    if (!previousScript && previousKind !== 'inputWait') {
      throw Object.assign(
        new Error(`Previous step "${previousLabel}" has no saved script.`),
        { status: 400 },
      );
    }

    const { browser, context, page, url, warmedUpSteps } = await this.warmupUntilNode({
      ...body,
      untilNodeId: previous.id,
    });

    let activePage = page;
    let apis: CapturedApiCall[] = [];
    try {
      apis = await collectApisDuring(context, async () => {
        if (previousScript) {
          const nextPage = await runPlaywrightScript(
            previousScript,
            context,
            activePage,
            () => undefined,
            false,
          );
          if (nextPage && nextPage !== activePage) {
            activePage = nextPage;
            await previewBridge
              .attach(activePage, { width: 1280, height: 720 })
              .catch(() => undefined);
          }
        }
        if (previousKind === 'inputWait') {
          const reason =
            String(previous.data?.description || '').trim() || previousLabel || 'human input';
          await dialog.showMessageBox({
            type: 'info',
            buttons: ['Continue'],
            defaultId: 0,
            title: `Paused for ${reason}`,
            message: 'Please complete this and press Continue.',
          });
        }
      });
    } catch (err) {
      await previewBridge.detach().catch(() => undefined);
      await browser.close().catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(
        new Error(`API capture failed on step "${previousLabel}": ${message}`),
        { status: 400 },
      );
    }

    const sessionId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.sessions.set(sessionId, {
      id: sessionId,
      browser,
      page: activePage,
      events: [],
      nextEventId: 1,
      lastPolledIdByClient: 0,
      recording: false,
      navWatchGeneration: 0,
    });
    console.log(
      `API capture ${sessionId}: warmed up ${warmedUpSteps} step(s), captured ${apis.length} call(s) from "${previousLabel}"`,
    );
    return { sessionId, apis, url, warmedUpSteps, previousStepLabel: previousLabel };
  }

  /** Start manual field picking for an active AI-fill capture session. */
  async startFieldPicker(sessionId: string): Promise<{ ok: true }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`Capture session ${sessionId} not found`), { status: 404 });
    }
    const bindingName = `__autoTesterFieldPicker_${sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    await clearFieldPicker(session.page);
    await installFieldPicker(session.page, bindingName, (payload) => {
      void (async () => {
        // The normalizer opens custom selects to discover lazy-rendered options.
        // Remove the picker first so those authoring clicks are not treated as picks.
        await clearFieldPicker(session.page);
        const normalized = await normalizePageFields(session.page);
        const fields = payload.fields.map((picked) => {
          const match = normalized.fields.find((field) =>
            field.locatorCandidates.some((locator) =>
              picked.locatorCandidates.includes(locator),
            ),
          );
          return match || picked;
        });
        await clearFieldPicker(session.page);
        previewBridge.emitFieldPicker(sessionId, fields);
      })();
    });
    return { ok: true };
  }

  /** Stop manual field picking without closing the warmed-up browser. */
  async stopFieldPicker(sessionId: string): Promise<{ ok: true }> {
    const session = this.sessions.get(sessionId);
    if (session) await clearFieldPicker(session.page);
    return { ok: true };
  }

  /** Paint a field set returned by AI discovery while keeping Preview interactive. */
  async highlightFields(
    sessionId: string,
    fields: Awaited<ReturnType<typeof normalizePageFields>>['fields'],
  ): Promise<{ ok: true }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`Capture session ${sessionId} not found`), { status: 404 });
    }
    await highlightFields(session.page, fields);
    return { ok: true };
  }

  /** Pick a Next/Submit-style button that should trigger frontend validation. */
  async startTriggerPicker(sessionId: string): Promise<{ ok: true }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`Capture session ${sessionId} not found`), { status: 404 });
    }
    const bindingName = `__autoTesterTriggerPicker_${sessionId.replace(/[^a-zA-Z0-9_]/g, '_')}`;
    await clearTriggerPicker(session.page);
    await installTriggerPicker(session.page, bindingName, (payload) => {
      void clearTriggerPicker(session.page).then(() => {
        previewBridge.emitTriggerPicker(sessionId, payload);
      });
    });
    return { ok: true };
  }

  /** Stop trigger picking without closing the warmed-up browser. */
  async stopTriggerPicker(sessionId: string): Promise<{ ok: true }> {
    const session = this.sessions.get(sessionId);
    if (session) await clearTriggerPicker(session.page);
    return { ok: true };
  }

  /**
   * After a recorded click, watch for URL change and/or a newly opened dialog.
   * Skips when neither happens. Newer clicks cancel older watchers.
   */
  private schedulePostClickAsserts(
    session: CaptureSession,
    urlBefore: string,
    dialogCountBefore: number,
  ) {
    const generation = ++session.navWatchGeneration;
    void (async () => {
      const deadline = Date.now() + NAV_DETECT_WINDOW_MS;
      let navEmitted = false;
      let dialogEmitted = false;
      while (Date.now() < deadline) {
        await sleep(NAV_POLL_MS);
        if (!session.recording) return;
        if (session.navWatchGeneration !== generation) return;
        try {
          if (!navEmitted) {
            const urlAfter = session.page.url();
            if (urlAfter !== urlBefore) {
              const line = urlAssertLine(urlAfter);
              try {
                // eslint-disable-next-line no-new
                new AsyncFunction('page', 'expect', 'context', line);
                session.events.push({
                  id: session.nextEventId++,
                  type: 'click',
                  scriptLine: line,
                  detail: `assert navigated (${NAV_ASSERT_TIMEOUT_MS}ms)`,
                  createdAt: new Date().toISOString(),
                });
                navEmitted = true;
              } catch {
                /* ignore parse */
              }
            }
          }
          if (!dialogEmitted) {
            const count = await session.page.getByRole('dialog').count();
            if (count > dialogCountBefore) {
              const dialog = session.page.getByRole('dialog').nth(count - 1);
              let name: string | undefined;
              try {
                name =
                  (await dialog.getAttribute('aria-label')) ||
                  (await dialog.locator('h1, h2, h3, [role="heading"]').first().textContent()) ||
                  undefined;
                name = name?.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
              } catch {
                name = undefined;
              }
              const line = dialogVisibleAssertLine(name);
              try {
                // eslint-disable-next-line no-new
                new AsyncFunction('page', 'expect', 'context', line);
                session.events.push({
                  id: session.nextEventId++,
                  type: 'click',
                  scriptLine: line,
                  detail: `assert dialog visible (${NAV_ASSERT_TIMEOUT_MS}ms)`,
                  createdAt: new Date().toISOString(),
                });
                dialogEmitted = true;
              } catch {
                /* ignore */
              }
            }
          }
          if (navEmitted && dialogEmitted) return;
        } catch {
          return;
        }
      }
    })();
  }

  async start(body: StartCaptureBody): Promise<{
    sessionId: string;
    url: string;
    warmedUpSteps: number;
  }> {
    const { browser, context, page, url, warmedUpSteps } = await this.warmupUntilNode(body);
    const sessionId = `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const session: CaptureSession = {
      id: sessionId,
      browser,
      page,
      events: [],
      nextEventId: 1,
      lastPolledIdByClient: 0,
      recording: false,
      navWatchGeneration: 0,
    };
    this.sessions.set(sessionId, session);

    /**
     * Binding on context so new tabs/iframes inherit it.
     * Verify locator against stamped element, then push the event.
     */
    await context.exposeFunction('__autoTesterCapture', async (payload: ElementPayload) => {
      if (!session.recording) return;

      const isFile =
        (payload.tagName || '').toLowerCase() === 'input' &&
        (payload.typeAttr || '').toLowerCase() === 'file';

      if (!isFile && !isActionablePayload(payload)) {
        await clearProbe(session.page, payload.probeId, payload.frameSelector);
        return;
      }

      const urlBefore = session.page.url();
      let dialogCountBefore = 0;
      try {
        dialogCountBefore = await session.page.getByRole('dialog').count();
      } catch {
        dialogCountBefore = 0;
      }

      try {
        const resolved = await resolveVerifiedAction(session.page, payload);
        if (!resolved) return;

        const { lines, detail } = resolved;
        const storedType: 'click' | 'fill' | 'press' | 'selectOption' | 'check' | 'uncheck' =
          payload.type === 'click'
            ? 'click'
            : payload.type === 'press'
              ? 'press'
              : payload.type === 'selectOption'
                ? 'selectOption'
                : payload.type === 'check' || payload.type === 'uncheck'
                  ? payload.type
                  : 'fill';
        const fp = `${storedType}::${lines.join('\n')}`;
        const fieldFp = fieldFingerprint(payload);
        const now = Date.now();

        if (
          session.lastFingerprint === fp &&
          session.lastEventAt &&
          now - session.lastEventAt < DEDUPE_MS
        ) {
          return;
        }

        // Enter already flushed fill+press — skip the change event that follows.
        if (
          storedType === 'fill' &&
          session.lastActionType === 'press' &&
          session.lastFieldFp === fieldFp &&
          session.lastEventAt &&
          now - session.lastEventAt < DEDUPE_MS * 3
        ) {
          return;
        }

        if (
          (storedType === 'fill' || storedType === 'selectOption') &&
          session.lastActionType === 'click' &&
          session.lastFieldFp === fieldFp &&
          session.events.length > 0
        ) {
          const last = session.events[session.events.length - 1];
          if (
            last.type === 'click' &&
            !last.scriptLine.includes('toHaveURL') &&
            !last.scriptLine.includes('toBeVisible')
          ) {
            session.events.pop();
          }
        }

        session.events.push({
          id: session.nextEventId++,
          type:
            storedType === 'selectOption'
              ? 'fill'
              : storedType === 'check' || storedType === 'uncheck'
                ? 'click'
                : storedType,
          scriptLine: lines.join('\n'),
          detail,
          createdAt: new Date().toISOString(),
        });
        session.lastFingerprint = fp;
        session.lastEventAt = now;
        session.lastFieldFp = fieldFp;
        session.lastActionType = storedType;

        // Enter can navigate / open dialogs the same way a click does.
        if (payload.type === 'click' || payload.type === 'press') {
          this.schedulePostClickAsserts(session, urlBefore, dialogCountBefore);
        }
      } catch (err) {
        console.warn('Capture resolve failed:', err);
      } finally {
        await clearProbe(session.page, payload.probeId, payload.frameSelector);
      }
    });

    // When a click opens a new tab, switch recording + amend last click if needed.
    context.on('page', (newPage) => {
      void (async () => {
        if (!session.recording) return;
        try {
          await newPage.waitForLoadState('domcontentloaded').catch(() => undefined);
          const last = session.events[session.events.length - 1];
          if (
            last &&
            last.type === 'click' &&
            !last.scriptLine.includes('waitForEvent') &&
            Date.now() - new Date(last.createdAt).getTime() < 3000
          ) {
            const clickLine = last.scriptLine.split('\n').find((l) => l.includes('.click('));
            if (clickLine) {
              last.scriptLine = wrapNewTabClick(clickLine);
              last.detail += ' + new tab';
            }
          }
          session.page = newPage;
          await previewBridge.attach(newPage, { width: 1280, height: 720 }).catch(() => undefined);
          await newPage.evaluate(installDomCapture).catch(() => undefined);
        } catch (err) {
          console.warn('Capture new-page switch failed:', err);
        }
      })();
    });

    await context.addInitScript(installDomCapture);
    await page.evaluate(installDomCapture);
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      await frame.evaluate(installDomCapture).catch(() => undefined);
    }
    session.page = page;
    session.recording = true;

    console.log(
      `Capture ${sessionId}: warmed up ${warmedUpSteps} step(s), recording for ${body.untilNodeId}`,
    );
    return { sessionId, url, warmedUpSteps };
  }

  pollEvents(sessionId: string, afterId?: number): CaptureEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`Capture session ${sessionId} not found`), { status: 404 });
    }
    const since = afterId ?? session.lastPolledIdByClient;
    const fresh = session.events.filter((e) => e.id > since);
    if (fresh.length) {
      session.lastPolledIdByClient = fresh[fresh.length - 1].id;
    }
    return fresh;
  }

  async stop(sessionId: string): Promise<{ ok: true; eventCount: number }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw Object.assign(new Error(`Capture session ${sessionId} not found`), { status: 404 });
    }
    const count = session.events.length;
    session.recording = false;
    await clearFieldPicker(session.page);
    await previewBridge.detach().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    this.sessions.delete(sessionId);
    return { ok: true, eventCount: count };
  }
}

export const captureManager = new CaptureManager();
