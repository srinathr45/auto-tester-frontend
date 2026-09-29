import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type StoredManualStep = {
  id: number;
  manualId: number;
  orderIndex: number;
  name: string;
  description: string | null;
  stepNodeId: string | null;
  screenshotArtifactId: number | null;
  beforeScreenshotArtifactId: number | null;
  afterScreenshotArtifactId: number | null;
};

export type StoredManual = {
  id: number;
  projectId: number;
  flowId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  steps: StoredManualStep[];
};

type StoreFile = {
  nextManualId: number;
  nextStepId: number;
  manuals: StoredManual[];
};

export type CreateManualInput = {
  projectId: number;
  flowId: number;
  title?: string;
  nodes?: Array<{ id?: string; data?: { label?: string; description?: string } }>;
};

function storePath(): string {
  return path.join(app.getPath('userData'), 'manuals.json');
}

function emptyStore(): StoreFile {
  return { nextManualId: 1, nextStepId: 1, manuals: [] };
}

function readStore(): StoreFile {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as StoreFile;
    if (!parsed || !Array.isArray(parsed.manuals)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

function writeStore(store: StoreFile) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), 'utf8');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Local manuals JSON store (Electron userData). Nest is not involved.
 */
export const manualStore = {
  list(filters: { flowId?: number; projectId?: number } = {}): StoredManual[] {
    let rows = readStore().manuals;
    if (filters.flowId != null) rows = rows.filter((m) => m.flowId === filters.flowId);
    if (filters.projectId != null) {
      rows = rows.filter((m) => m.projectId === filters.projectId);
    }
    return clone(rows).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  get(id: number): StoredManual {
    const row = readStore().manuals.find((m) => m.id === id);
    if (!row) throw new Error(`Manual ${id} not found`);
    return clone(row);
  },

  create(input: CreateManualInput): StoredManual {
    const store = readStore();
    const now = new Date().toISOString();
    const id = store.nextManualId++;
    const title = input.title?.trim() || `Flow ${input.flowId} Manual`;
    const steps: StoredManualStep[] = (input.nodes || []).map((node, index) => ({
      id: store.nextStepId++,
      manualId: id,
      orderIndex: index,
      name: node.data?.label || `Step ${index + 1}`,
      description: node.data?.description || null,
      stepNodeId: node.id || null,
      screenshotArtifactId: null,
      beforeScreenshotArtifactId: null,
      afterScreenshotArtifactId: null,
    }));
    const manual: StoredManual = {
      id,
      projectId: input.projectId,
      flowId: input.flowId,
      title,
      createdAt: now,
      updatedAt: now,
      steps,
    };
    store.manuals.push(manual);
    writeStore(store);
    return clone(manual);
  },

  update(id: number, data: { title?: string }): StoredManual {
    const store = readStore();
    const row = store.manuals.find((m) => m.id === id);
    if (!row) throw new Error(`Manual ${id} not found`);
    if (data.title !== undefined) row.title = data.title;
    row.updatedAt = new Date().toISOString();
    writeStore(store);
    return clone(row);
  },

  remove(id: number): { ok: true } {
    const store = readStore();
    const before = store.manuals.length;
    store.manuals = store.manuals.filter((m) => m.id !== id);
    if (store.manuals.length === before) throw new Error(`Manual ${id} not found`);
    writeStore(store);
    return { ok: true };
  },

  updateStep(
    manualId: number,
    stepId: number,
    data: Partial<{
      name: string;
      description: string | null;
      orderIndex: number;
      screenshotArtifactId: number | null;
      beforeScreenshotArtifactId: number | null;
      afterScreenshotArtifactId: number | null;
    }>,
  ): StoredManualStep {
    const store = readStore();
    const manual = store.manuals.find((m) => m.id === manualId);
    if (!manual) throw new Error(`Manual ${manualId} not found`);
    const step = manual.steps.find((s) => s.id === stepId);
    if (!step) throw new Error(`Manual step ${stepId} not found`);
    if (data.name !== undefined) step.name = data.name;
    if (data.description !== undefined) step.description = data.description;
    if (data.orderIndex !== undefined) step.orderIndex = data.orderIndex;
    if (data.screenshotArtifactId !== undefined) {
      step.screenshotArtifactId = data.screenshotArtifactId;
    }
    if (data.beforeScreenshotArtifactId !== undefined) {
      step.beforeScreenshotArtifactId = data.beforeScreenshotArtifactId;
    }
    if (data.afterScreenshotArtifactId !== undefined) {
      step.afterScreenshotArtifactId = data.afterScreenshotArtifactId;
      if (data.screenshotArtifactId === undefined) {
        step.screenshotArtifactId = data.afterScreenshotArtifactId;
      }
    }
    manual.updatedAt = new Date().toISOString();
    writeStore(store);
    return clone(step);
  },
};
