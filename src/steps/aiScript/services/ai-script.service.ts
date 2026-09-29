import { aiService } from '../../../ai/services/ai.service';
import { recordingService } from '../../../recording/services/recording.service';
import type { HtmlCatalogItem, HtmlLocateHint } from '../../../shared/types';

const MANY_HTML_MATCHES = 3;

export type AiScriptCaptureFn = () => Promise<{
  sessionId: string;
  catalog: HtmlCatalogItem[];
}>;

function isSessionGone(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /session is no longer active/i.test(message) || /SESSION_GONE/.test(message);
}

async function sliceWithSession(
  sessionId: string,
  body: { hint?: HtmlLocateHint; pickedIds?: string[] },
  recapture: AiScriptCaptureFn,
): Promise<{ sessionId: string; htmlElements: string; candidates: HtmlCatalogItem[] }> {
  try {
    const sliced = await recordingService.sliceHtml(sessionId, body);
    return { sessionId, ...sliced };
  } catch (err) {
    if (!isSessionGone(err)) throw err;
    const next = await recapture();
    const sliced = await recordingService.sliceHtml(next.sessionId, body);
    return { sessionId: next.sessionId, ...sliced };
  }
}

/**
 * Ask AI what to look for, slice that section from the live page, and
 * optionally narrow once when the slice is too large or too many matches.
 */
export async function prepareAiScriptHtml(input: {
  goal: string;
  sessionId: string | null;
  recapture: AiScriptCaptureFn;
}): Promise<{ sessionId: string; htmlElements: string; catalog?: HtmlCatalogItem[] }> {
  const goal = String(input.goal || '').trim();
  if (!goal) throw new Error('Write a goal describing what this step should do.');

  let sessionId = input.sessionId;
  let catalog: HtmlCatalogItem[] | undefined;
  if (!sessionId) {
    const captured = await input.recapture();
    sessionId = captured.sessionId;
    catalog = captured.catalog;
  }

  const hint = await aiService.locateHint({ goal });
  let sliced = await sliceWithSession(sessionId, { hint }, input.recapture);
  sessionId = sliced.sessionId;

  if (!sliced.candidates.length) {
    throw new Error('No matching controls for this goal. Recapture the page or rephrase the goal.');
  }

  const needsNarrow =
    !sliced.htmlElements.trim() || sliced.candidates.length > MANY_HTML_MATCHES;
  if (needsNarrow) {
    const narrowed = await aiService.narrowTargets({
      goal,
      candidates: sliced.candidates,
    });
    if (narrowed.pick.length) {
      sliced = await sliceWithSession(
        sessionId,
        { pickedIds: narrowed.pick },
        input.recapture,
      );
    } else if (narrowed.namePattern) {
      sliced = await sliceWithSession(
        sessionId,
        { hint: { ...hint, namePattern: narrowed.namePattern } },
        input.recapture,
      );
    }
    sessionId = sliced.sessionId;
  }

  if (!sliced.htmlElements.trim()) {
    throw new Error('Could not find a small enough page section for this goal.');
  }
  return { sessionId, htmlElements: sliced.htmlElements, catalog };
}
