import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_ORIGIN = 'http://127.0.0.1:3001';

let cached: string | null = null;

/**
 * Accept host, origin, or full /api URL and always return `{origin}/api`.
 */
export function normalizeApiBackendUrl(raw?: string | null): string {
  let url = String(raw || '').trim();
  if (!url) url = DEFAULT_ORIGIN;
  url = url.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (!/\/api$/i.test(url)) url = `${url}/api`;
  return url;
}

function envUrl(): string | undefined {
  return (
    process.env.API_BACKEND_URL ||
    process.env.NEST_API_URL ||
    process.env.VITE_API_BACKEND_URL ||
    process.env.VITE_API_URL
  );
}

function configPath(): string | null {
  try {
    if (!app.isReady()) return null;
    return path.join(app.getPath('userData'), 'api-backend.json');
  } catch {
    return null;
  }
}

function readStored(): string | undefined {
  const file = configPath();
  if (!file) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { apiBackendUrl?: string };
    return parsed.apiBackendUrl;
  } catch {
    return undefined;
  }
}

/** Load KEY=value pairs from app/.env into process.env when unset. */
export function applyDotEnvFile() {
  const files = [path.join(process.cwd(), '.env'), path.join(__dirname, '../.env')];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = value;
    }
  }
}

export function nestApiBase(): string {
  if (cached) return cached;
  cached = normalizeApiBackendUrl(readStored() || envUrl() || DEFAULT_ORIGIN);
  return cached;
}

export function getApiBackendUrl(): string {
  return nestApiBase();
}

export function setApiBackendUrl(raw: string): string {
  const url = normalizeApiBackendUrl(raw);
  cached = url;
  const file = configPath();
  if (file) {
    try {
      fs.writeFileSync(file, JSON.stringify({ apiBackendUrl: url }, null, 2));
    } catch (err) {
      console.warn('Could not persist API_BACKEND_URL:', err);
    }
  }
  return url;
}
