import { aiService } from '../../../ai/services/ai.service';
import type {
  AiFillConditionalAction,
  AiFillField,
  AiFillFieldSuggestion,
} from '../../../shared/types';

function jsString(value: string): string {
  return JSON.stringify(value);
}

function locatorFor(field: AiFillField): string {
  const locator = field.locatorCandidates[0];
  if (!locator) throw new Error(`No trusted locator exists for "${field.label}"`);
  return `page.locator(${jsString(locator)})`;
}

function labelBase(field: AiFillField): string {
  return field.label.replace(/\s+/g, ' ').trim().replace(/[^a-zA-Z0-9 ]/g, '') || 'Test value';
}

function randomOption(field: AiFillField) {
  const options = (field.options || []).filter((item) => item.value || item.label);
  if (!options.length) {
    throw new Error(`Select "${field.label}" has no usable options. Open the dropdown and capture it again.`);
  }
  // Choose at authoring time so the saved script remains stable across runs.
  return options[Math.floor(Math.random() * options.length)];
}

function valueExpression(field: AiFillField): string {
  const label = labelBase(field);
  const lower = `${field.label} ${field.name || ''} ${field.type || ''}`.toLowerCase();
  if (field.kind === 'select') {
    const option = randomOption(field);
    return jsString(option.value || option.label);
  }
  if (field.kind === 'checkbox' || field.kind === 'radio') return 'true';
  if (/email/.test(lower)) return '`test.user.${Date.now()}@example.com`';
  if (/phone|mobile|telephone/.test(lower)) return '`555${Math.floor(1000000 + Math.random() * 9000000)}`';
  if (/date/.test(lower)) return '`2026-01-15`';
  if (/number|amount|count|quantity|zip|postal/.test(lower)) return '`42`';
  return `\`${label.replace(/`/g, '')} ${'${Date.now()}'}\``;
}

function selectAction(field: AiFillField, locator: string, value: string): string {
  const option = field.options?.find((item) => item.value === value);
  if (!option) throw new Error(`Select "${field.label}" has no matching option`);
  if (field.type === 'combobox' || field.type === 'listbox') {
    return [
      `await ${locator}.click();`,
      `await page.getByRole('option', { name: ${jsString(option.label)}, exact: true }).click().catch(() => page.getByText(${jsString(option.label)}, { exact: true }).click());`,
    ].join('\n');
  }
  if (field.type === 'list') {
    return [
      `await ${locator}.click();`,
      `await page.getByText(${jsString(option.label)}, { exact: true }).click();`,
    ].join('\n');
  }
  return `await ${locator}.selectOption(${jsString(option.value)});`;
}

/**
 * Compile locally generated values using only locators captured by Electron.
 * No network request is made for ordinary field filling.
 */
export function compileLocalFillScript(fields: AiFillField[]): string {
  if (!fields.length) throw new Error('Select at least one field before generating');
  return fields.map((field) => {
    const locator = locatorFor(field);
    if (field.kind === 'checkbox' || field.kind === 'radio') {
      return `await ${locator}.check();`;
    }
    if (field.kind === 'select') {
      const option = randomOption(field);
      return selectAction(field, locator, option.value || option.label);
    }
    return `await ${locator}.fill(${valueExpression(field)});`;
  }).join('\n');
}

/**
 * Compile AI-selected actions after validating every field against the
 * user-confirmed normalized set.
 */
export function compileConditionalFillScript(
  fields: AiFillField[],
  actions: AiFillConditionalAction[],
): string {
  const byId = new Map(fields.map((field) => [field.fieldId, field]));
  return actions.map((action) => {
    const field = byId.get(action.fieldId);
    if (!field) throw new Error(`AI returned unknown field "${action.fieldId}"`);
    const locator = locatorFor(field);
    const lines: string[] = [];
    if (action.assert === 'enabled') lines.push(`await expect(${locator}).toBeEnabled();`);
    if (action.assert === 'visible') lines.push(`await expect(${locator}).toBeVisible();`);
    if (action.assert === 'present') lines.push(`await expect(${locator}).toHaveCount(1);`);
    if (action.action === 'fill') {
      lines.push(`await ${locator}.fill(${jsString(action.value || '')});`);
    } else if (action.action === 'select') {
      const option = field.options?.find((item) => item.value === action.value);
      if (!option) throw new Error(`AI selected an invalid option for "${field.label}"`);
      lines.push(selectAction(field, locator, option.value));
    } else if (action.action === 'check') {
      lines.push(`await ${locator}.check();`);
    } else if (action.action === 'click') {
      lines.push(`await ${locator}.click();`);
    }
    return lines.join('\n');
  }).join('\n');
}

export const aiFillService = {
  suggestFields: (goal: string, fields: AiFillField[], anchorFieldIds: string[]) => {
    const semanticFields = fields.map(({ locatorCandidates: _locators, ...field }) => field);
    return aiService.suggestFields({ goal, fields: semanticFields, anchorFieldIds });
  },

  generateConditionalFill: (
    goal: string,
    fields: AiFillField[],
    anchorFieldIds: string[],
  ) => {
    const semanticFields = fields.map(({ locatorCandidates: _locators, ...field }) => field);
    return aiService.generateConditionalFill({
      goal,
      fields: semanticFields,
      anchorFieldIds,
    });
  },

  mergeSuggestions: (
    fields: AiFillField[],
    suggestions: AiFillFieldSuggestion[],
  ): AiFillField[] => {
    const suggestedIds = new Set(suggestions.map((suggestion) => suggestion.fieldId).filter(Boolean));
    return fields.filter((field) => suggestedIds.has(field.fieldId));
  },
};
