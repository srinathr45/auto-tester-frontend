import type { Page } from '@playwright/test';

export const HTML_SLICE_MAX = 20000;
export const MANY_HTML_MATCHES = 3;
const HTML_ID_ATTR = 'data-at-html-id';
const INTERACTIVE_SELECTOR =
  'button, a, [role="button"], [role="link"], [role="tab"], input, textarea, select, summary, [contenteditable="true"], [contenteditable=""], [role="textbox"]';

export type HtmlLocateAction = 'click' | 'fill' | 'check' | 'assert';

export type HtmlLocateHint = {
  action: HtmlLocateAction;
  tags: string[];
  roles: string[];
  namePattern: string;
  scopeHint?: string;
};

export type HtmlCatalogItem = {
  id: string;
  tag: string;
  role: string;
  name: string;
  scope: string;
  htmlSize: number;
};

export type HtmlSliceResult = {
  htmlElements: string;
  candidates: HtmlCatalogItem[];
};

const clean = (value: string | null | undefined) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

function stripHeavyHtml(html: string): string {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
}

/** Case-insensitive substring match for visible names from a locate hint. */
export function nameMatches(value: string, pattern: string): boolean {
  const needle = clean(pattern).toLowerCase();
  if (!needle) return true;
  return clean(value).toLowerCase().includes(needle);
}

/** True when a catalog row fits the AI hint (tags, roles, name, optional scope). */
export function matchesHint(item: HtmlCatalogItem, hint: HtmlLocateHint): boolean {
  const tags = (hint.tags || []).map((tag) => tag.toLowerCase());
  const roles = (hint.roles || []).map((role) => role.toLowerCase());
  if (tags.length && !tags.includes(item.tag.toLowerCase())) return false;
  if (roles.length && item.role && !roles.includes(item.role.toLowerCase())) return false;
  if (!nameMatches(item.name, hint.namePattern)) return false;
  const scopeHint = clean(hint.scopeHint).toLowerCase();
  if (scopeHint && !item.scope.toLowerCase().includes(scopeHint)) return false;
  return true;
}

/**
 * Lower is better. Prefer main/form/dialog and exact names; demote nav/footer.
 */
export function rankCatalogItem(item: HtmlCatalogItem, hint: HtmlLocateHint): number {
  const scope = item.scope.toLowerCase();
  let rank = 0;
  if (/\bnav\b|\bfooter\b|\baside\b|\bheader\b/.test(scope)) rank += 50;
  if (/\bmain\b|\bform\b|\bdialog\b|\btoolbar\b/.test(scope)) rank -= 20;
  const pattern = clean(hint.namePattern).toLowerCase();
  const name = item.name.toLowerCase();
  if (pattern && name === pattern) rank -= 30;
  else if (pattern && name.startsWith(pattern)) rank -= 10;
  return rank;
}

/**
 * Filter and rank catalog rows. If a scopeHint matches nothing, retry without it
 * so a vague "form" hint does not hide a valid button.
 */
export function selectCatalogMatches(
  catalog: HtmlCatalogItem[],
  hint: HtmlLocateHint,
): HtmlCatalogItem[] {
  const scoped = catalog.filter((item) => matchesHint(item, hint));
  const matches =
    scoped.length || !clean(hint.scopeHint)
      ? scoped
      : catalog.filter((item) => matchesHint(item, { ...hint, scopeHint: '' }));
  return [...matches].sort((left, right) => rankCatalogItem(left, hint) - rankCatalogItem(right, hint));
}

/** Prefer a small parent (form/dialog) so the model still has context. */
export function chooseSliceHtml(controlHtml: string, parentHtml: string, maxChars: number): string {
  const parent = stripHeavyHtml(parentHtml);
  if (parent && parent.length <= maxChars) return parent;
  const control = stripHeavyHtml(controlHtml);
  if (control.length <= maxChars) return control;
  return control.slice(0, maxChars);
}

/**
 * Concatenate unique slices. When allowClip is false and the total is over the
 * cap, return empty markup so the caller can ask AI to narrow the set.
 */
export function joinHtmlSlices(
  slices: string[],
  maxChars: number,
  allowClip: boolean,
): { htmlElements: string; overCap: boolean } {
  const unique = [...new Set(slices.map((slice) => slice.trim()).filter(Boolean))];
  const joined = unique.join('\n');
  if (joined.length <= maxChars) return { htmlElements: joined, overCap: false };
  if (!allowClip) return { htmlElements: '', overCap: true };
  return { htmlElements: joined.slice(0, maxChars), overCap: true };
}

/**
 * Stamp visible interactive controls and return a compact catalog (no markup).
 * Ids stay on the live page so a later extract can find the same nodes.
 */
export async function listHtmlCatalog(page: Page): Promise<HtmlCatalogItem[]> {
  if (page.isClosed()) return [];
  return page.evaluate(
    ({ selector, attr }) => {
      const tidy = (value: string | null | undefined) =>
        String(value || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 160);
      const isVisible = (element: HTMLElement) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          Number(style.opacity || 1) > 0 &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const impliedRole = (element: HTMLElement) => {
        const explicit = tidy(element.getAttribute('role')).toLowerCase();
        if (explicit) return explicit;
        const tag = element.tagName.toLowerCase();
        const type = (element as HTMLInputElement).type?.toLowerCase() || '';
        if (tag === 'button' || type === 'submit' || type === 'button') return 'button';
        if (tag === 'a') return 'link';
        if (tag === 'summary') return 'button';
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea' || tag === 'input') return 'textbox';
        if (
          element.isContentEditable ||
          element.getAttribute('contenteditable') === 'true' ||
          element.getAttribute('contenteditable') === ''
        ) {
          return 'textbox';
        }
        return '';
      };
      const accessibleName = (element: HTMLElement) => {
        const input = element as HTMLInputElement;
        return (
          tidy(element.getAttribute('aria-label')) ||
          tidy(element.getAttribute('title')) ||
          tidy(element.textContent) ||
          tidy(input.value) ||
          tidy(input.placeholder) ||
          tidy(element.getAttribute('data-placeholder')) ||
          tidy(input.name) ||
          tidy(element.tagName)
        );
      };
      const scopeFor = (element: HTMLElement) => {
        const landmark = element.closest(
          'main, form, [role="dialog"], [role="toolbar"], nav, header, footer, aside',
        ) as HTMLElement | null;
        if (!landmark) return '';
        const label =
          tidy(landmark.getAttribute('aria-label')) ||
          tidy(landmark.querySelector('legend, h1, h2, h3')?.textContent);
        const kind =
          landmark.getAttribute('role') ||
          landmark.tagName.toLowerCase();
        return tidy([kind, label].filter(Boolean).join(' '));
      };

      document.querySelectorAll(`[${attr}]`).forEach((node) => node.removeAttribute(attr));
      const catalog: HtmlCatalogItem[] = [];
      const seen = new Set<HTMLElement>();
      const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
      for (const element of nodes) {
        if (seen.has(element)) continue;
        seen.add(element);
        const input = element as HTMLInputElement;
        if (input.type === 'hidden' || input.disabled) continue;
        if (element.getAttribute('aria-disabled') === 'true') continue;
        if (!isVisible(element)) continue;
        const id = `c${catalog.length + 1}`;
        element.setAttribute(attr, id);
        catalog.push({
          id,
          tag: element.tagName.toLowerCase(),
          role: impliedRole(element),
          name: accessibleName(element),
          scope: scopeFor(element),
          htmlSize: element.outerHTML.length,
        });
      }
      return catalog;
    },
    { selector: INTERACTIVE_SELECTOR, attr: HTML_ID_ATTR },
  );
}

type ExtractedSlice = { id: string; controlHtml: string; parentHtml: string };

/** Read stamped controls and a nearby parent so generate still has context. */
export async function extractHtmlSlices(page: Page, ids: string[]): Promise<ExtractedSlice[]> {
  if (page.isClosed() || !ids.length) return [];
  return page.evaluate(
    ({ attr, wanted }) => {
      const parentSelector =
        'form, [role="dialog"], [role="toolbar"], [role="group"], fieldset, section';
      return wanted.flatMap((id) => {
        const element = document.querySelector(`[${attr}="${id}"]`) as HTMLElement | null;
        if (!element) return [];
        const parent = element.closest(parentSelector) as HTMLElement | null;
        return [
          {
            id,
            controlHtml: element.outerHTML,
            parentHtml: parent && parent !== document.body ? parent.outerHTML : '',
          },
        ];
      });
    },
    { attr: HTML_ID_ATTR, wanted: ids },
  );
}

function slicesToMarkup(
  extracted: ExtractedSlice[],
  allowClip: boolean,
): { htmlElements: string; overCap: boolean } {
  const html = extracted.map((item) =>
    chooseSliceHtml(item.controlHtml, item.parentHtml, HTML_SLICE_MAX),
  );
  return joinHtmlSlices(html, HTML_SLICE_MAX, allowClip);
}

/**
 * Find hint matches on the live page and return either a small HTML slice
 * or catalog-only candidates when the slice would exceed the token budget.
 */
export async function sliceHtmlForHint(page: Page, hint: HtmlLocateHint): Promise<HtmlSliceResult> {
  const catalog = await listHtmlCatalog(page);
  const candidates = selectCatalogMatches(catalog, hint);
  if (!candidates.length) return { htmlElements: '', candidates: [] };
  const extracted = await extractHtmlSlices(
    page,
    candidates.map((item) => item.id),
  );
  const { htmlElements, overCap } = slicesToMarkup(extracted, false);
  if (overCap || candidates.length > MANY_HTML_MATCHES) {
    return { htmlElements: '', candidates };
  }
  return { htmlElements, candidates };
}

/** Extract already-picked catalog ids. Always clips so generate can proceed. */
export async function sliceHtmlByIds(
  page: Page,
  ids: string[],
  catalog: HtmlCatalogItem[] = [],
): Promise<HtmlSliceResult> {
  const extracted = await extractHtmlSlices(page, ids);
  const { htmlElements } = slicesToMarkup(extracted, true);
  const wanted = new Set(ids);
  return {
    htmlElements,
    candidates: catalog.filter((item) => wanted.has(item.id)),
  };
}
