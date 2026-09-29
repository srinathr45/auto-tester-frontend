import type { Page } from '@playwright/test';
import type { AiFillField } from './types';

const FIELD_SELECTOR =
  'input:not([type="hidden"]):not([type="submit"]):not([type="reset"]):not([type="button"]):not([type="file"]):not([type="password"]), textarea, select, ul, ol, button[aria-expanded], button[aria-haspopup], [role="combobox"], [role="listbox"], [role="checkbox"], [role="radio"], [contenteditable="true"], [contenteditable=""], [role="textbox"]';
const PICKER_STYLE_ID = 'auto-tester-ai-fill-picker';

export type NormalizedFieldResult = {
  formFound: boolean;
  fields: AiFillField[];
};

type PickerPayload = {
  fields: AiFillField[];
};

/**
 * Extract safe, visible controls from the page without returning the page HTML.
 * The result is used both for local value generation and for explicit AI requests.
 */
export async function normalizePageFields(page: Page): Promise<NormalizedFieldResult> {
  if (page.isClosed()) return { formFound: false, fields: [] };

  return page.evaluate(async (selector) => {
    type Field = {
      fieldId: string;
      label: string;
      name?: string;
      type?: string;
      kind: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio';
      required: boolean;
      visible: boolean;
      enabled: boolean;
      locatorCandidates: string[];
      options?: Array<{ label: string; value: string }>;
      pattern?: string;
      group?: string;
    };

    const clean = (value: string | null | undefined) =>
      String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    const cssEscape = (value: string) =>
      typeof CSS !== 'undefined' && CSS.escape
        ? CSS.escape(value)
        : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const isStableId = (value: string | null | undefined) =>
      Boolean(
        value &&
          !value.includes(':') &&
          !/^(_r_|_r-|:r|radix-|mui-|react-|ember\d)/i.test(value),
      );
    const slug = (value: string) =>
      clean(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'field';
    const cssPathFor = (element: HTMLElement) => {
      const parts: string[] = [];
      let current: HTMLElement | null = element;
      let depth = 0;
      while (current && current !== document.body && depth < 8) {
        if (isStableId(current.id)) {
          parts.unshift(`#${cssEscape(current.id)}`);
          break;
        }
        let part = current.tagName.toLowerCase();
        const parent: HTMLElement | null = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children as HTMLCollectionOf<HTMLElement>).filter(
            (child) => child.tagName === current?.tagName,
          );
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
        parts.unshift(part);
        current = parent;
        depth += 1;
      }
      return parts.join(' > ');
    };

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

    const labelTextFrom = (element: HTMLElement, candidate: Element | null | undefined) => {
      if (!candidate || candidate === element) return '';
      const candidateElement = candidate as HTMLElement;
      if (!isVisible(candidateElement)) return '';
      const clone = candidateElement.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll('input, textarea, select, button, svg, [aria-hidden="true"]')
        .forEach((child) => child.remove());
      const text = clean(clone.textContent);
      return text && text.length <= 100 ? text : '';
    };

    const nearbyLabelFor = (element: HTMLElement) => {
      const parent = element.parentElement;
      const candidates = [
        ...(Array.from((element as HTMLInputElement).labels || []) as Element[]),
        element.previousElementSibling,
        parent?.querySelector(':scope > label, :scope > legend'),
        parent?.previousElementSibling,
      ];
      for (const candidate of candidates) {
        const text = labelTextFrom(element, candidate);
        if (text) return text;
      }
      return '';
    };

    const labelFor = (element: HTMLElement) => {
      const input = element as HTMLInputElement;
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = clean(
          labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent)
            .filter(Boolean)
            .join(' '),
        );
        if (text) return text;
      }

      const parent = element.closest('label');
      const associatedLabel =
        (isStableId(input.id)
          ? document.querySelector(`label[for="${cssEscape(input.id)}"]`)
          : null) || parent;
      const associatedText = labelTextFrom(element, associatedLabel) || clean(parent?.textContent);
      if (associatedText) return associatedText;

      const nearbyText = nearbyLabelFor(element);
      if (nearbyText) return nearbyText;

      // Placeholder is intentionally last: it describes an example value, not the field.
      return clean(
        element.getAttribute('aria-label') ||
          input.name ||
          element.getAttribute('data-placeholder') ||
          element.getAttribute('placeholder') ||
          element.textContent ||
          input.type ||
          element.tagName,
      );
    };

    /** Font-size / alignment <select> inside a rich-text toolbar is not the form field. */
    const isRichTextToolbarControl = (element: HTMLElement) => {
      const tag = element.tagName.toLowerCase();
      const isSelectLike =
        tag === 'select' ||
        element.getAttribute('role') === 'combobox' ||
        /listbox|combobox/i.test(element.getAttribute('aria-haspopup') || '');
      if (!isSelectLike && tag !== 'button') return false;
      let parent: HTMLElement | null = element.parentElement;
      for (let depth = 0; depth < 6 && parent; depth++) {
        const editable = parent.querySelector(
          '[contenteditable="true"], [contenteditable=""]',
        ) as HTMLElement | null;
        if (editable && editable !== element && !editable.contains(element)) {
          const optionLabels =
            tag === 'select'
              ? Array.from((element as HTMLSelectElement).options).map((option) =>
                  clean(option.textContent).toLowerCase(),
                )
              : [];
          const fontSized = optionLabels.some((label) =>
            /^(small|medium|large|huge|tiny|normal|heading|paragraph|title)$/.test(label) ||
            /^\d+(\s?(px|pt))?$/.test(label),
          );
          const toolbarButtons = parent.querySelectorAll('button, [role="button"]').length;
          if (fontSized || toolbarButtons >= 3) return true;
        }
        parent = parent.parentElement;
      }
      return false;
    };

    const isContentEditableField = (element: HTMLElement) =>
      element.isContentEditable ||
      element.getAttribute('contenteditable') === 'true' ||
      element.getAttribute('contenteditable') === '';

    type NormalizedOption = { label: string; value: string };
    const dynamicOptions = new WeakMap<HTMLElement, NormalizedOption[]>();
    const listLikeSelector = 'ul, ol, [role="listbox"], [role="menu"]';
    const optionSelector =
      ':scope > li, :scope > [role="option"], :scope > [role="menuitemradio"], :scope > [role="menuitemcheckbox"]';

    const optionsFromRoot = (root: HTMLElement): NormalizedOption[] => {
      let optionElements = Array.from(root.querySelectorAll(optionSelector));
      if (!optionElements.length) {
        optionElements = Array.from(
          root.querySelectorAll(
            'li, [role="option"], [role="menuitemradio"], [role="menuitemcheckbox"]',
          ),
        );
      }
      const seen = new Set<string>();
      return optionElements
        .filter((option) => isVisible(option as HTMLElement))
        .map((option) => ({
          element: option as HTMLElement,
          label: clean(option.textContent || option.getAttribute('aria-label')),
          value:
            option.getAttribute('data-value') ||
            option.getAttribute('value') ||
            clean(option.textContent),
        }))
        .filter((option) => {
          if (
            !option.label ||
            !option.value ||
            option.element.getAttribute('aria-disabled') === 'true'
          ) {
            return false;
          }
          const key = `${option.label}\u0000${option.value}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(({ label, value }) => ({ label, value }));
    };

    const listFor = (element: HTMLElement): HTMLElement | null => {
      if (element.matches(listLikeSelector)) return element;
      const controlledId = element.getAttribute('aria-controls');
      if (controlledId) {
        const controlled = document.getElementById(controlledId);
        if (controlled?.matches(listLikeSelector)) return controlled as HTMLElement;
        const nested = controlled?.querySelector(listLikeSelector);
        if (nested) return nested as HTMLElement;
      }
      const closest = element.closest(listLikeSelector);
      if (closest) return closest as HTMLElement;
      const parent = element.parentElement;
      return (parent?.querySelector(
        ':scope > ul, :scope > ol, :scope > [role="listbox"], :scope > [role="menu"]',
      ) ||
        element.nextElementSibling?.closest(listLikeSelector)) as HTMLElement | null;
    };
    const listControlFor = (list: HTMLElement): HTMLElement => {
      const controlledBy = document.querySelector(
        `button[aria-controls="${cssEscape(list.id)}"], [role="combobox"][aria-controls="${cssEscape(list.id)}"]`,
      ) as HTMLElement | null;
      if (controlledBy) return controlledBy;
      const wrapper = list.parentElement;
      const nearby = wrapper?.querySelector(
        ':scope > button[aria-expanded], :scope > button[aria-haspopup], :scope > [role="combobox"]',
      ) as HTMLElement | null;
      return nearby || list;
    };
    const fieldRootFor = (element: HTMLElement): HTMLElement => {
      const list = listFor(element);
      return list ? listControlFor(list) : element;
    };
    const nearestVisiblePopup = (element: HTMLElement): HTMLElement | null => {
      const rect = element.getBoundingClientRect();
      const candidates = Array.from(document.querySelectorAll(listLikeSelector))
        .map((candidate) => candidate as HTMLElement)
        .filter((candidate) => isVisible(candidate) && optionsFromRoot(candidate).length);
      candidates.sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        const leftDistance = Math.hypot(
          leftRect.left + leftRect.width / 2 - (rect.left + rect.width / 2),
          leftRect.top + leftRect.height / 2 - (rect.top + rect.height / 2),
        );
        const rightDistance = Math.hypot(
          rightRect.left + rightRect.width / 2 - (rect.left + rect.width / 2),
          rightRect.top + rightRect.height / 2 - (rect.top + rect.height / 2),
        );
        return leftDistance - rightDistance;
      });
      return candidates[0] || null;
    };

    const listOptionsFor = (element: HTMLElement) => {
      const list = listFor(element);
      const remembered = dynamicOptions.get(element);
      if (remembered?.length) return remembered;
      const isCustomLike = element.matches(
        'button[aria-haspopup], button[aria-expanded], [role="combobox"], [role="listbox"]',
      );
      if (!list && !isCustomLike) return [];
      const controlledId = element.getAttribute('aria-controls');
      const optionRoot =
        list ||
        (controlledId ? document.getElementById(controlledId) : null) ||
        element.closest('fieldset, [role="group"], form, section');
      if (!optionRoot) return [];
      return optionsFromRoot(optionRoot as HTMLElement);
    };

    const fields: Field[] = [];
    const controls: HTMLElement[] = [];
    const seenRoots = new Set<HTMLElement>();
    const forms = (Array.from(document.querySelectorAll('form')) as HTMLFormElement[]).filter(
      (form) => isVisible(form),
    );
    const sourceElements = forms.length
      ? forms.flatMap((form) => Array.from(form.querySelectorAll(selector)))
      : Array.from(document.querySelectorAll(selector));

    // Closed custom selects often render their options only after opening.
    // Expand each trigger during authoring, remember its options, then restore its state.
    const customSelects = sourceElements
      .map((element) => element as HTMLElement)
      .filter(
        (element) =>
          element.matches(
            'button[aria-haspopup="listbox"], button[aria-haspopup="combobox"], [role="combobox"]',
          ) &&
          (!forms.length || Boolean(element.closest('form'))),
      );
    for (const element of customSelects) {
      const existingList = listFor(element);
      const wasOpen =
        element.getAttribute('aria-expanded') === 'true' ||
        Boolean(existingList && isVisible(existingList));
      if (!wasOpen) {
        element.click();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const popup = listFor(element) || nearestVisiblePopup(element);
      const options = popup ? optionsFromRoot(popup) : [];
      if (options.length) dynamicOptions.set(element, options);
      if (!wasOpen) {
        if (element.getAttribute('aria-expanded') === 'true') {
          element.click();
        } else {
          element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
      }
    }

    for (const element of sourceElements) {
      const el = element as HTMLElement;
      if (el.matches('[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')) {
        continue;
      }
      if (isRichTextToolbarControl(el)) continue;
      if (
        el.matches('[role="textbox"]') &&
        el.querySelector('[contenteditable="true"], [contenteditable=""]')
      ) {
        continue;
      }
      if (
        isContentEditableField(el) &&
        el.parentElement?.closest('[contenteditable="true"], [contenteditable=""]')
      ) {
        continue;
      }
      const root = el.matches('ul, ol') ? fieldRootFor(el) : el;
      if (forms.length && !root.closest('form')) continue;
      if (
        (!root.matches('ul, ol') && root.querySelector('ul, ol') === null) &&
        !isVisible(root)
      ) {
        continue;
      }
      if (!isVisible(root) || (root as HTMLInputElement).disabled) continue;
      if (root.getAttribute('aria-disabled') === 'true') continue;
      if (root.matches('ul, ol') && !listOptionsFor(root).length) continue;
      if (
        root.matches('button[aria-expanded], button[aria-haspopup]') &&
        !listFor(root) &&
        !dynamicOptions.has(root) &&
        !/listbox|combobox/i.test(root.getAttribute('aria-haspopup') || root.getAttribute('role') || '')
      ) {
        continue;
      }
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);
      controls.push(root);
    }

    controls.forEach((element, index) => {
      const tag = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;
      const role = element.getAttribute('role') || '';
      const listOptions = listOptionsFor(element);
      const isCustomSelect =
        (tag === 'button' &&
          /listbox|combobox/i.test(element.getAttribute('aria-haspopup') || '')) ||
        role === 'combobox' ||
        dynamicOptions.has(element);
      const isHtmlList = Boolean(listFor(element));
      const isListField = Boolean(listOptions.length) || isCustomSelect;
      const editable = isContentEditableField(element);
      const type =
        isListField
          ? isHtmlList
            ? 'list'
            : 'combobox'
          : editable
          ? 'textbox'
          : tag === 'input'
          ? (input.type || 'text').toLowerCase()
          : role === 'combobox' || role === 'listbox'
            ? role
            : tag;
      const label = labelFor(element);
      const kind =
        isListField
          ? 'select'
          : tag === 'textarea' || editable
          ? 'textarea'
          : tag === 'select' || role === 'combobox' || role === 'listbox'
            ? 'select'
            : type === 'checkbox'
              ? 'checkbox'
                : type === 'radio' || role === 'radio'
                ? 'radio'
                  : role === 'checkbox'
                    ? 'checkbox'
                : 'text';
      const fieldId = `${slug(label || input.name || type)}-${index + 1}`;
      const candidates: string[] = [];
      if (isStableId(input.id)) candidates.push(`#${cssEscape(input.id)}`);
      if (input.name) candidates.push(`${tag}[name="${cssEscape(input.name)}"]`);
      const dataPlaceholder = element.getAttribute('data-placeholder');
      if (dataPlaceholder) {
        candidates.push(`[data-placeholder="${cssEscape(dataPlaceholder)}"]`);
      }
      if (!candidates.length) {
        candidates.push(cssPathFor(element));
      }

      const options =
        isListField
          ? listOptions
          : kind === 'select'
          ? tag === 'select'
            ? Array.from((element as HTMLSelectElement).options)
                .filter((option) => !option.disabled)
                .map((option) => ({
                  label: clean(option.textContent),
                  value: option.value,
                }))
            : (() => {
                const controlledId = element.getAttribute('aria-controls');
                const optionRoot = controlledId
                  ? document.getElementById(controlledId)
                  : element.closest('fieldset, [role="group"], form, section');
                return Array.from(
                  optionRoot?.querySelectorAll(
                    '[role="option"], [role="menuitemradio"], [role="menuitemcheckbox]',
                  ) || [],
                )
                  .filter((option) => isVisible(option as HTMLElement))
                  .map((option) => ({
                    label: clean(option.textContent || option.getAttribute('aria-label')),
                    value:
                      option.getAttribute('data-value') ||
                      option.getAttribute('value') ||
                      clean(option.textContent),
                  }));
              })()
          : undefined;
      const group = clean(
        element.closest('fieldset, [role="group"], form, section')?.getAttribute('aria-label') ||
          element.closest('fieldset, [role="group"], form, section')?.querySelector('legend, h1, h2, h3')
            ?.textContent,
      );

      fields.push({
        fieldId,
        label,
        name: input.name || element.getAttribute('name') || undefined,
        type,
        kind,
        required: Boolean(input.required || element.getAttribute('aria-required') === 'true'),
        visible: true,
        enabled: true,
        locatorCandidates: candidates,
        options: options?.length ? options : undefined,
        pattern: input.pattern || undefined,
        group: group || undefined,
      });
    });

    return {
      formFound: forms.length > 0,
      fields,
    };
  }, FIELD_SELECTOR);
}

/**
 * Pick a field and return it with nearby controls that share its form-like structure.
 * The user confirmation step remains the final authority over the proposed set.
 */
export async function findSimilarFields(
  page: Page,
  fieldId: string,
): Promise<AiFillField[]> {
  const result = await normalizePageFields(page);
  const selected = result.fields.find((field) => field.fieldId === fieldId);
  if (!selected) return [];
  const selectedIndex = Number(fieldId.match(/-(\d+)$/)?.[1] || 1) - 1;
  const sameGroup = result.fields.filter(
    (field) => field.group && selected.group && field.group === selected.group,
  );
  if (sameGroup.length > 1) return sameGroup;
  return result.fields.filter(
    (field, index) => index === selectedIndex || (field.kind === selected.kind && index < selectedIndex + 6),
  );
}

/**
 * Inject a picker overlay into the page. The page remains interactive through
 * Preview, but picker clicks are consumed and never become test actions.
 */
export async function installFieldPicker(
  page: Page,
  bindingName: string,
  onPick: (payload: PickerPayload) => void,
): Promise<void> {
  try {
    await page.exposeFunction(bindingName, onPick);
  } catch {
    // The same capture session can re-enter picker mode after "Add field".
  }
  await page.evaluate(
    ({ selector, styleId, binding }) => {
      const existing = document.getElementById(styleId);
      existing?.remove();
      const root = document.createElement('div');
      root.id = styleId;
      root.setAttribute('data-auto-tester-overlay', 'true');
      Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2147483646',
      });
      document.documentElement.appendChild(root);

      const clean = (value: string | null | undefined) =>
        String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const cssEscape = (value: string) =>
        typeof CSS !== 'undefined' && CSS.escape
          ? CSS.escape(value)
          : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const isStableId = (value: string | null | undefined) =>
        Boolean(
          value &&
            !value.includes(':') &&
            !/^(_r_|_r-|:r|radix-|mui-|react-|ember\d)/i.test(value),
        );
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
      const labelTextFrom = (element: HTMLElement, candidate: Element | null | undefined) => {
        if (!candidate || candidate === element) return '';
        const candidateElement = candidate as HTMLElement;
        if (!isVisible(candidateElement)) return '';
        const clone = candidateElement.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll('input, textarea, select, button, svg, [aria-hidden="true"]')
          .forEach((child) => child.remove());
        const text = clean(clone.textContent);
        return text && text.length <= 100 ? text : '';
      };
      const labelFor = (element: HTMLElement) => {
        const input = element as HTMLInputElement;
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = clean(
            labelledBy
              .split(/\s+/)
              .map((id) => document.getElementById(id)?.textContent)
              .filter(Boolean)
              .join(' '),
          );
          if (text) return text;
        }

        const parent = element.closest('label');
        const associatedLabel =
          (isStableId(input.id)
            ? document.querySelector(`label[for="${cssEscape(input.id)}"]`)
            : null) || parent;
        const associatedText = labelTextFrom(element, associatedLabel) || clean(parent?.textContent);
        if (associatedText) return associatedText;

        const parentElement = element.parentElement;
        const nearbyCandidates = [
          ...(Array.from((input.labels || []) as NodeListOf<HTMLLabelElement>) as Element[]),
          element.previousElementSibling,
          parentElement?.querySelector(':scope > label, :scope > legend'),
          parentElement?.previousElementSibling,
        ];
        for (const candidate of nearbyCandidates) {
          const text = labelTextFrom(element, candidate);
          if (text) return text;
        }

        return clean(
          element.getAttribute('aria-label') ||
            input.name ||
            element.getAttribute('data-placeholder') ||
            element.getAttribute('placeholder') ||
            element.textContent ||
            input.type ||
            element.tagName,
        );
      };
      const isContentEditableField = (element: HTMLElement) =>
        element.isContentEditable ||
        element.getAttribute('contenteditable') === 'true' ||
        element.getAttribute('contenteditable') === '';
      const isRichTextToolbarControl = (element: HTMLElement) => {
        const tag = element.tagName.toLowerCase();
        const isSelectLike =
          tag === 'select' ||
          element.getAttribute('role') === 'combobox' ||
          /listbox|combobox/i.test(element.getAttribute('aria-haspopup') || '');
        if (!isSelectLike && tag !== 'button') return false;
        let parent: HTMLElement | null = element.parentElement;
        for (let depth = 0; depth < 6 && parent; depth++) {
          const editable = parent.querySelector(
            '[contenteditable="true"], [contenteditable=""]',
          ) as HTMLElement | null;
          if (editable && editable !== element && !editable.contains(element)) {
            const optionLabels =
              tag === 'select'
                ? Array.from((element as HTMLSelectElement).options).map((option) =>
                    clean(option.textContent).toLowerCase(),
                  )
                : [];
            const fontSized = optionLabels.some(
              (label) =>
                /^(small|medium|large|huge|tiny|normal|heading|paragraph|title)$/.test(label) ||
                /^\d+(\s?(px|pt))?$/.test(label),
            );
            const toolbarButtons = parent.querySelectorAll('button, [role="button"]').length;
            if (fontSized || toolbarButtons >= 3) return true;
          }
          parent = parent.parentElement;
        }
        return false;
      };
      const nearbyContentEditable = (element: HTMLElement) => {
        let parent: HTMLElement | null = element.parentElement;
        for (let depth = 0; depth < 6 && parent; depth++) {
          const editable = parent.querySelector(
            '[contenteditable="true"], [contenteditable=""]',
          ) as HTMLElement | null;
          if (editable && isVisible(editable)) return editable;
          parent = parent.parentElement;
        }
        return null;
      };
      const cssPathFor = (element: HTMLElement) => {
        const parts: string[] = [];
        let current: HTMLElement | null = element;
        let depth = 0;
        while (current && current !== document.body && depth < 8) {
          if (isStableId(current.id)) {
            parts.unshift(`#${cssEscape(current.id)}`);
            break;
          }
          let part = current.tagName.toLowerCase();
          const parent: HTMLElement | null = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children as HTMLCollectionOf<HTMLElement>).filter(
              (child) => child.tagName === current?.tagName,
            );
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
          parts.unshift(part);
          current = parent;
          depth += 1;
        }
        return parts.join(' > ');
      };
      const listFor = (element: HTMLElement): HTMLElement | null => {
        if (element.matches('ul, ol')) return element;
        const controlledId = element.getAttribute('aria-controls');
        if (controlledId) {
          const controlled = document.getElementById(controlledId);
          if (controlled?.matches('ul, ol')) return controlled as HTMLElement;
          const nested = controlled?.querySelector('ul, ol');
          if (nested) return nested as HTMLElement;
        }
        return (element.closest('ul, ol') || element.querySelector('ul, ol')) as HTMLElement | null;
      };
      const listControlFor = (list: HTMLElement) => {
        const controlledBy = document.querySelector(
          `button[aria-controls="${cssEscape(list.id)}"], [role="combobox"][aria-controls="${cssEscape(list.id)}"]`,
        ) as HTMLElement | null;
        if (controlledBy) return controlledBy;
        const wrapper = list.parentElement;
        return (
          wrapper?.querySelector(
            ':scope > button[aria-expanded], :scope > button[aria-haspopup], :scope > [role="combobox"]',
          ) as HTMLElement | null
        ) || list;
      };
      const fieldRootFor = (element: HTMLElement) => {
        const list = listFor(element);
        return list ? listControlFor(list) : element;
      };
      const listOptionsFor = (element: HTMLElement) => {
        const list = listFor(element);
        const controlledId = element.getAttribute('aria-controls');
        const optionRoot =
          list ||
          (controlledId ? document.getElementById(controlledId) : null) ||
          element.closest('fieldset, [role="group"], form, section');
        if (!optionRoot) return [];
        return Array.from(optionRoot.querySelectorAll(':scope > li, :scope > [role="option"]'))
          .map((option) => ({
            label: clean(option.textContent || option.getAttribute('aria-label')),
            value:
              option.getAttribute('data-value') ||
              option.getAttribute('value') ||
              clean(option.textContent),
          }));
      };
      const listLabelFor = (element: HTMLElement) => {
        const list = listFor(element);
        const wrapper = list?.parentElement;
        return (
          clean(element.getAttribute('aria-label')) ||
          clean(element.textContent) ||
          clean(wrapper?.getAttribute('aria-label')) ||
          clean(wrapper?.querySelector('legend, h1, h2, h3')?.textContent) ||
          'List selection'
        );
      };
      const locatorFor = (element: HTMLElement) => {
        const input = element as HTMLInputElement;
        if (isStableId(input.id)) return `#${cssEscape(input.id)}`;
        if (input.name) return `${element.tagName.toLowerCase()}[name="${cssEscape(input.name)}"]`;
        const dataPlaceholder = element.getAttribute('data-placeholder');
        if (dataPlaceholder) return `[data-placeholder="${cssEscape(dataPlaceholder)}"]`;
        return cssPathFor(element);
      };
      const fieldFor = (target: Element | null) => {
        const targetElement = target as HTMLElement | null;
        const list = targetElement?.closest('ul, ol');
        let element = list
          ? fieldRootFor(list as HTMLElement)
          : (targetElement?.closest(selector) as HTMLElement | null);
        if (element && isRichTextToolbarControl(element)) {
          element = nearbyContentEditable(element);
        }
        if (!element) return null;
        const forms = (Array.from(document.querySelectorAll('form')) as HTMLFormElement[]).filter(
          (form) => {
            const rect = form.getBoundingClientRect();
            const style = window.getComputedStyle(form);
            return (
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0
            );
          },
        );
        if (forms.length && !element.closest('form')) return null;
        const controls: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();
        const sourceElements = forms.length
          ? forms.flatMap((form) => Array.from(form.querySelectorAll(selector)))
          : Array.from(document.querySelectorAll(selector));
        for (const node of sourceElements) {
          const raw = node as HTMLElement;
          const root = raw.matches('ul, ol') ? fieldRootFor(raw) : raw;
          if (forms.length && !root.closest('form')) continue;
          const rect = root.getBoundingClientRect();
          const style = window.getComputedStyle(root);
          if (
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            rect.width <= 0 ||
            rect.height <= 0 ||
            (root as HTMLInputElement).disabled ||
            seen.has(root) ||
            isRichTextToolbarControl(root)
          ) {
            continue;
          }
          seen.add(root);
          controls.push(root);
        }
        const index = controls.indexOf(element);
        if (index < 0) return null;
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role') || '';
        const editable = isContentEditableField(element);
        const isCustomSelect =
          tag === 'button' &&
          /listbox|combobox/i.test(element.getAttribute('aria-haspopup') || '');
        const htmlList = Boolean(listFor(element));
        const listField = htmlList || isCustomSelect;
        const label = listField
          ? listLabelFor(element)
          : labelFor(element);
        const input = element as HTMLInputElement;
        const type =
          listField
            ? htmlList
              ? 'list'
              : 'combobox'
            : editable
              ? 'textbox'
            :
          tag === 'input'
            ? input.type || 'text'
            : role === 'combobox' || role === 'listbox'
              ? role
              : tag;
        const kind =
          listField
            ? 'select'
            :
          tag === 'textarea' || editable
            ? 'textarea'
            : tag === 'select' || role === 'combobox' || role === 'listbox'
              ? 'select'
              : type === 'checkbox'
                ? 'checkbox'
                : type === 'radio' || role === 'radio'
                  ? 'radio'
                  : role === 'checkbox'
                    ? 'checkbox'
                  : 'text';
        const fieldId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'field'}-${index + 1}`;
        const rootElement = listField
          ? listFor(element)?.parentElement || element.parentElement
          : element.closest('form, fieldset, [role="group"], section') || element.parentElement;
        const similar = (listField
          ? Array.from(rootElement?.querySelectorAll(':scope > ul, :scope > ol') || []).map(
              (node) => fieldRootFor(node as HTMLElement),
            )
          : Array.from(rootElement?.querySelectorAll(selector) || []).filter((node) => {
          const el = node as HTMLInputElement;
          const rect = el.getBoundingClientRect();
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            !(el as HTMLInputElement).disabled &&
            (el.tagName.toLowerCase() === tag ||
              ((el as HTMLInputElement).type || 'text') === type)
          );
          }) as HTMLElement[]);
        const chosen = similar.length > 1 ? similar : [element];
        return {
          fieldId,
          label,
          kind,
          type,
          listField,
          chosen,
        };
      };
      let hoveredElements: HTMLElement[] = [];
      const paint = (elements: HTMLElement[]) => {
        hoveredElements = elements;
        root.replaceChildren(
          ...elements.map((element) => {
            const rect = element.getBoundingClientRect();
            const box = document.createElement('div');
            Object.assign(box.style, {
              position: 'fixed',
              left: `${rect.left}px`,
              top: `${rect.top}px`,
              width: `${rect.width}px`,
              height: `${rect.height}px`,
              background: 'rgba(56, 189, 248, 0.18)',
              border: '2px solid rgba(56, 189, 248, 0.9)',
              borderRadius: '4px',
              boxSizing: 'border-box',
            });
            return box;
          }),
        );
      };
      const repaint = () => paint(hoveredElements);
      const onMove = (event: MouseEvent) => {
        const info = fieldFor(document.elementFromPoint(event.clientX, event.clientY));
        paint(info?.chosen || []);
      };
      const onClick = (event: MouseEvent) => {
        const info = fieldFor(document.elementFromPoint(event.clientX, event.clientY));
        if (!info) return;
        event.preventDefault();
        event.stopPropagation();
        void (window as unknown as Record<string, (payload: unknown) => Promise<void>>)[binding]({
          fields: info.chosen.map((element, index) => {
            const listOptions = listOptionsFor(element);
            const input = element as HTMLInputElement;
            const tag = element.tagName.toLowerCase();
            return {
              fieldId: `${info.fieldId}-${index + 1}`,
              label: info.listField
                ? listLabelFor(element)
                : labelFor(element) || info.label,
              kind: info.kind,
              name: input.name || undefined,
              type: info.listField
                ? 'list'
                : isContentEditableField(element)
                  ? 'textbox'
                  : tag === 'input'
                    ? input.type || 'text'
                    : tag,
              required: Boolean(input.required || element.getAttribute('aria-required') === 'true'),
              visible: true,
              enabled: true,
              locatorCandidates: [locatorFor(element)],
              options: info.listField
                ? listOptions
                : info.kind === 'select' && tag === 'select'
                  ? Array.from((element as HTMLSelectElement).options)
                      .filter((option) => !option.disabled)
                      .map((option) => ({
                        label: clean(option.textContent),
                        value: option.value,
                      }))
                  : undefined,
            };
          }),
        });
      };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      window.addEventListener('scroll', repaint, true);
      window.addEventListener('resize', repaint);
      (window as unknown as Record<string, unknown>).__autoTesterPickerCleanup = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        window.removeEventListener('scroll', repaint, true);
        window.removeEventListener('resize', repaint);
        root.remove();
      };
    },
    { selector: FIELD_SELECTOR, styleId: PICKER_STYLE_ID, binding: bindingName },
  );
}

export async function clearFieldPicker(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const cleanup = (window as unknown as { __autoTesterPickerCleanup?: () => void })
        .__autoTesterPickerCleanup;
      cleanup?.();
      const staticCleanup = (
        window as unknown as { __autoTesterStaticHighlightCleanup?: () => void }
      ).__autoTesterStaticHighlightCleanup;
      staticCleanup?.();
      document.getElementById('auto-tester-ai-fill-picker')?.remove();
    })
    .catch(() => undefined);
}

/** Highlight a confirmed or AI-suggested field set without enabling picker mode. */
export async function highlightFields(page: Page, fields: AiFillField[]): Promise<void> {
  await page.evaluate(
    ({ styleId, selectors }) => {
      const previousCleanup = (
        window as unknown as { __autoTesterStaticHighlightCleanup?: () => void }
      ).__autoTesterStaticHighlightCleanup;
      previousCleanup?.();
      const root =
        document.getElementById(styleId) ||
        (() => {
          const created = document.createElement('div');
          created.id = styleId;
          Object.assign(created.style, {
            position: 'fixed',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '2147483646',
          });
          document.documentElement.appendChild(created);
          return created;
        })();
      const paint = () => {
        root.replaceChildren(
          ...selectors.flatMap((selector) =>
            Array.from(document.querySelectorAll(selector)).map((element) => {
              const rect = element.getBoundingClientRect();
              const box = document.createElement('div');
              Object.assign(box.style, {
                position: 'fixed',
                left: `${rect.left}px`,
                top: `${rect.top}px`,
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                background: 'rgba(168, 85, 247, 0.18)',
                border: '2px solid rgba(168, 85, 247, 0.9)',
                borderRadius: '4px',
                boxSizing: 'border-box',
              });
              return box;
            }),
          ),
        );
      };
      paint();
      window.addEventListener('scroll', paint, true);
      window.addEventListener('resize', paint);
      (
        window as unknown as { __autoTesterStaticHighlightCleanup?: () => void }
      ).__autoTesterStaticHighlightCleanup = () => {
        window.removeEventListener('scroll', paint, true);
        window.removeEventListener('resize', paint);
        root.remove();
      };
    },
    {
      styleId: PICKER_STYLE_ID,
      selectors: fields.flatMap((field) => field.locatorCandidates),
    },
  );
}

export type TriggerPickerPayload = {
  label: string;
  locatorCandidates: string[];
  clickScriptLine: string;
};

const TRIGGER_PICKER_STYLE_ID = 'auto-tester-trigger-picker';

/** Remove the trigger picker overlay and listeners from the live page. */
export async function clearTriggerPicker(page: Page): Promise<void> {
  await page
    .evaluate((styleId) => {
      const cleanup = (window as unknown as { __autoTesterTriggerPickerCleanup?: () => void })
        .__autoTesterTriggerPickerCleanup;
      cleanup?.();
      document.getElementById(styleId)?.remove();
    }, TRIGGER_PICKER_STYLE_ID)
    .catch(() => undefined);
}

/**
 * Let the user click a Next/Submit-style control in Preview.
 * Returns trusted locator metadata for validation trigger clicks.
 */
export async function installTriggerPicker(
  page: Page,
  bindingName: string,
  onPick: (payload: TriggerPickerPayload) => void,
): Promise<void> {
  try {
    await page.exposeFunction(bindingName, onPick);
  } catch {
    // The same capture session can re-enter picker mode.
  }
  await page.evaluate(
    ({ styleId, binding }) => {
      const previousCleanup = (
        window as unknown as { __autoTesterTriggerPickerCleanup?: () => void }
      ).__autoTesterTriggerPickerCleanup;
      previousCleanup?.();

      const root = document.createElement('div');
      root.id = styleId;
      root.setAttribute('data-auto-tester-overlay', 'true');
      Object.assign(root.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2147483646',
      });
      document.documentElement.appendChild(root);

      const clean = (value: string | null | undefined) =>
        String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const cssEscape = (value: string) =>
        typeof CSS !== 'undefined' && CSS.escape
          ? CSS.escape(value)
          : value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const isStableId = (value: string | null | undefined) =>
        Boolean(
          value &&
            !value.includes(':') &&
            !/^(_r_|_r-|:r|radix-|mui-|react-|ember\d)/i.test(value),
        );
      const cssPathFor = (element: HTMLElement) => {
        const parts: string[] = [];
        let current: HTMLElement | null = element;
        let depth = 0;
        while (current && current !== document.body && depth < 8) {
          if (isStableId(current.id)) {
            parts.unshift(`#${cssEscape(current.id)}`);
            break;
          }
          let part = current.tagName.toLowerCase();
          const parent: HTMLElement | null = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children as HTMLCollectionOf<HTMLElement>).filter(
              (child) => child.tagName === current?.tagName,
            );
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
          parts.unshift(part);
          current = parent;
          depth += 1;
        }
        return parts.join(' > ');
      };
      const triggerFor = (target: Element | null) => {
        const element = target?.closest(
          'button, a, summary, input[type="submit"], input[type="button"], [role="button"]',
        ) as HTMLElement | null;
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          rect.width <= 0 ||
          rect.height <= 0
        ) {
          return null;
        }
        const input = element as HTMLInputElement;
        const label =
          clean(element.getAttribute('aria-label')) ||
          clean(element.getAttribute('title')) ||
          clean(element.textContent) ||
          clean(input.value) ||
          clean(input.name) ||
          'Trigger button';
        const candidates: string[] = [];
        const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
        if (testId) candidates.push(`[data-testid="${cssEscape(testId)}"]`);
        if (isStableId(element.id)) candidates.push(`#${cssEscape(element.id)}`);
        if (input.name) candidates.push(`${element.tagName.toLowerCase()}[name="${cssEscape(input.name)}"]`);
        const cssPath = cssPathFor(element);
        if (cssPath) candidates.push(cssPath);
        const locator = candidates[0];
        if (!locator) return null;
        return {
          label,
          locatorCandidates: [...new Set(candidates)],
          clickScriptLine: `await page.locator(${JSON.stringify(locator)}).click();`,
        };
      };

      let hovered: HTMLElement | null = null;
      const paint = (element: HTMLElement | null) => {
        hovered = element;
        root.replaceChildren();
        if (!element) return;
        const rect = element.getBoundingClientRect();
        const box = document.createElement('div');
        Object.assign(box.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          background: 'rgba(251, 191, 36, 0.18)',
          border: '2px solid rgba(251, 191, 36, 0.95)',
          borderRadius: '4px',
          boxSizing: 'border-box',
        });
        root.appendChild(box);
      };
      const repaint = () => paint(hovered);
      const onMove = (event: MouseEvent) => {
        const element = document.elementFromPoint(event.clientX, event.clientY)?.closest(
          'button, a, summary, input[type="submit"], input[type="button"], [role="button"]',
        ) as HTMLElement | null;
        paint(element);
      };
      const onClick = (event: MouseEvent) => {
        const picked = triggerFor(document.elementFromPoint(event.clientX, event.clientY));
        if (!picked) return;
        event.preventDefault();
        event.stopPropagation();
        void (window as unknown as Record<string, (payload: unknown) => Promise<void>>)[binding](
          picked,
        );
      };
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('click', onClick, true);
      window.addEventListener('scroll', repaint, true);
      window.addEventListener('resize', repaint);
      (
        window as unknown as { __autoTesterTriggerPickerCleanup?: () => void }
      ).__autoTesterTriggerPickerCleanup = () => {
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('click', onClick, true);
        window.removeEventListener('scroll', repaint, true);
        window.removeEventListener('resize', repaint);
        root.remove();
      };
    },
    { styleId: TRIGGER_PICKER_STYLE_ID, binding: bindingName },
  );
}
