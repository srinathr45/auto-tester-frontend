import { getNestAuthToken, nestApiBase } from './artifactUpload';

export type FillPlanField = {
  locator: string;
  value: string;
  action: string;
};

/**
 * Ask Nest for a runtime fill plan. Uses the JWT the renderer already pushed
 * via auth:setToken. Does not persist the plan.
 */
export async function requestFillPlan(
  goal: string,
  snapshot: string,
): Promise<FillPlanField[]> {
  const token = getNestAuthToken();
  const res = await fetch(`${nestApiBase()}/ai/fill-plan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ goal, snapshot }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    message?: string | string[];
    fields?: FillPlanField[];
  };
  if (!res.ok) {
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message || `AI fill failed (${res.status})`;
    throw new Error(message);
  }
  const fields = Array.isArray(body.fields) ? body.fields : [];
  if (!fields.length) {
    throw new Error('AI fill plan returned no fields');
  }
  return fields;
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

/** Turn a locator string into a `page.…` expression the runner can eval. */
function toPageExpr(locator: string): string {
  const loc = locator.trim();
  if (!loc) return '';
  if (loc.startsWith('page.')) return loc;
  if (/^(getBy|locator\s*\()/.test(loc)) return `page.${loc}`;
  return `page.locator('${escapeJs(loc)}')`;
}

/**
 * Compile fill-plan fields into a one-off Playwright snippet.
 * Not saved onto the node — runtime AI fill only.
 */
export function fillPlanToScript(fields: FillPlanField[]): string {
  const lines: string[] = [];
  for (const field of fields) {
    const expr = toPageExpr(field.locator);
    if (!expr) continue;
    const action = (field.action || 'fill').toLowerCase();
    const value = escapeJs(field.value ?? '');
    if (action === 'click') {
      lines.push(`await ${expr}.click();`);
    } else if (action === 'check') {
      lines.push(`await ${expr}.check();`);
    } else if (action === 'select') {
      lines.push(`await ${expr}.selectOption('${value}');`);
    } else {
      lines.push(`await ${expr}.fill('${value}');`);
    }
  }
  if (!lines.length) {
    throw new Error('AI fill plan produced no Playwright actions');
  }
  return lines.join('\n');
}
