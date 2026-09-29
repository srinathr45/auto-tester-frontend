import type { ApiValidateConfig, ApiValidateItem, CapturedApiCall } from '../../../shared/types';

export function apiAlias(index: number): string {
  return `api${index + 1}`;
}

/**
 * Join per-API snippets in one scope so consts from api1 are visible in api3.
 * Do not wrap cards in `{ }` — Frontend Validator isolates fields; API check does not.
 */
export function compileCombinedApiScripts(apis: ApiValidateItem[]): string {
  return apis
    .map((item) => item.scriptText?.trim() || '')
    .filter(Boolean)
    .join('\n\n');
}

export function withReassignedAliases(apis: ApiValidateItem[]): ApiValidateItem[] {
  return apis.map((item, index) => ({ ...item, alias: apiAlias(index) }));
}

/** Keep selected cards that still exist after a recapture (id, then method+path+occurrence). */
export function rematchSelectedApis(
  captured: CapturedApiCall[],
  previous: ApiValidateItem[],
): ApiValidateItem[] {
  return previous
    .map((item) => {
      const match =
        captured.find((call) => call.id === item.api.id) ||
        captured.find(
          (call) =>
            call.method === item.api.method &&
            call.urlPattern === item.api.urlPattern &&
            (call.occurrence || 1) === (item.api.occurrence || 1),
        );
      if (!match) return null;
      return { ...item, api: match };
    })
    .filter((item): item is ApiValidateItem => Boolean(item));
}

export function refreshApiValidateScripts(config: ApiValidateConfig): {
  config: ApiValidateConfig;
  scriptText: string;
} {
  const apis = withReassignedAliases(config.apis || []);
  const nextConfig = { ...config, apis };
  return {
    config: nextConfig,
    scriptText: compileCombinedApiScripts(apis),
  };
}

export function applyApiGenerationResults(
  apis: ApiValidateItem[],
  scripts: Array<{ alias: string; scriptText: string }>,
): ApiValidateItem[] {
  const byAlias = new Map(scripts.map((row) => [row.alias, row.scriptText]));
  return apis.map((item) => {
    if (item.scriptMode === 'manual') return item;
    const scriptText = byAlias.get(item.alias);
    if (scriptText === undefined) return item;
    return { ...item, scriptText };
  });
}
