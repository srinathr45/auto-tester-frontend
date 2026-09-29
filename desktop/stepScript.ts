import { expect, type BrowserContext, type Page } from '@playwright/test';
import type { FlowNode, StepKind } from './types';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

/** Missing or unknown kind runs as a saved Playwright script. */
export function resolveNodeStepKind(node: FlowNode): StepKind {
  const kind = node.data?.stepKind;
  if (
    kind === 'aiFill' ||
    kind === 'inputWait' ||
    kind === 'aiScript' ||
    kind === 'loop' ||
    kind === 'patternValidate' ||
    kind === 'apiValidate'
  ) {
    return kind;
  }
  return 'script';
}

/** URL expect mismatches are warnings (id drift); other failures still fail the step. */
export function isUrlAssertMismatch(message: string): boolean {
  const m = message || '';
  if (!/toHaveURL|to\.have\.url/i.test(m)) return false;
  return (
    /Expected pattern/i.test(m) ||
    /Received string/i.test(m) ||
    /unexpected value/i.test(m)
  );
}

/**
 * Soft-wrap Playwright expect so toHaveURL mismatches warn instead of throwing.
 * Other assertions still throw. Works for existing hard-coded scripts without re-capture.
 */
function createSoftUrlExpect(onWarn: (message: string) => void): typeof expect {
  const soft = ((actual: unknown) => {
    const assertion = expect(actual);
    return new Proxy(assertion, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (prop === 'toHaveURL' && typeof value === 'function') {
          return async (...args: unknown[]) => {
            try {
              return await (value as (...a: unknown[]) => Promise<unknown>).apply(
                target,
                args,
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              if (isUrlAssertMismatch(message)) {
                console.warn('[URL assert warning]', message);
                onWarn(message);
                return undefined;
              }
              throw err;
            }
          };
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }) as typeof expect;
  return Object.assign(soft, expect);
}

/**
 * Resolve the Playwright JS that should run for this node.
 * AI-fill scripts are authored once and execute like ordinary saved scripts.
 */
export async function resolveExecutableScript(
  _page: Page | null,
  node: FlowNode,
): Promise<string> {
  return String(node.data?.scriptText || '').trim();
}

/** Net change to `{` / `[` nesting on one line (skips strings and comments). */
export function bracketDepthDelta(line: string): number {
  let delta = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < line.length - 1 && !(line[i] === '*' && line[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === '`') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '{') delta++;
    else if (ch === '}') delta--;
    else if (ch === '[') delta++;
    else if (ch === ']') delta--;
    i++;
  }
  return delta;
}

/** Insert pauses only between top-level statements so nested objects/arrays stay valid. */
export function injectLineDelays(scriptText: string, lineDelayMs: number): string {
  if (lineDelayMs <= 0) return scriptText;
  const delayLine = `await new Promise((r) => setTimeout(r, ${lineDelayMs}));`;
  const lines = scriptText.split('\n');
  const parts: string[] = [];
  let depth = 0;
  let seenTopLevel = false;
  for (const line of lines) {
    if (!line.trim()) {
      parts.push(line);
      continue;
    }
    if (depth === 0 && seenTopLevel) {
      parts.push(delayLine);
    }
    parts.push(line);
    depth = Math.max(0, depth + bracketDepthDelta(line));
    if (depth === 0) seenTopLevel = true;
  }
  return parts.join('\n');
}

/**
 * Compile and run one Playwright body. Returns the (possibly new) page
 * when the script reassigns `page` after a popup.
 * @param softUrlAsserts when true (Run default), toHaveURL mismatches warn; when false (Capture warm-up), they throw like plain expect.
 * @param lineDelayMs pause before each script line (max 1000ms) so Preview is easier to follow.
 * The evaluated script also receives `warn(message)` so expected validation gaps can continue.
 */
export async function runPlaywrightScript(
  scriptText: string,
  context: BrowserContext | null,
  sharedPage: Page | null,
  onWarn: (message: string) => void = () => undefined,
  softUrlAsserts = true,
  lineDelayMs = 0,
  extraBindings: Record<string, unknown> = {},
): Promise<Page | null> {
  const body = injectLineDelays(scriptText, lineDelayMs);
  const expectFn = softUrlAsserts ? createSoftUrlExpect(onWarn) : expect;
  const bindingNames = Object.keys(extraBindings).filter((name) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(name),
  );
  const fn = new AsyncFunction(
    'expect',
    'context',
    '__page',
    'warn',
    ...bindingNames,
    `let page = __page;\n${body}\nreturn page;`,
  );

  const nextPage = await fn(
    expectFn,
    context,
    sharedPage,
    onWarn,
    ...bindingNames.map((name) => extraBindings[name]),
  );

  if (
    nextPage &&
    typeof nextPage === 'object' &&
    typeof (nextPage as Page).goto === 'function'
  ) {
    return nextPage as Page;
  }
  return sharedPage;
}

/**
 * Resolve + run one node's script. Returns the active page (may change on popup).
 * Throws if the script is empty after resolve, or if Playwright fails.
 */
export async function executeNodeScript(opts: {
  node: FlowNode;
  context: BrowserContext | null;
  page: Page | null;
  onUrlWarn?: (message: string) => void;
}): Promise<{ page: Page | null; scriptText: string; kind: StepKind }> {
  const { node, context, onUrlWarn } = opts;
  let page = opts.page;
  const kind = resolveNodeStepKind(node);
  const scriptText = await resolveExecutableScript(page, node);
  if (!scriptText) {
    throw new Error(
      kind === 'aiFill'
        ? 'AI fill produced an empty script'
        : 'Script step has empty scriptText',
    );
  }
  const nextPage = await runPlaywrightScript(
    scriptText,
    context,
    page,
    onUrlWarn || (() => undefined),
  );
  if (nextPage) page = nextPage;
  return { page, scriptText, kind };
}
