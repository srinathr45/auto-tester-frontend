import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Ask where to save, then write the buffer.
 * Returns the chosen path, or null if the user cancelled.
 */
export async function pickAndSaveFile(opts: {
  defaultFilename: string;
  filters: { name: string; extensions: string[] }[];
  buffer: Buffer;
}): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const options = {
    defaultPath: path.join(app.getPath('downloads'), opts.defaultFilename),
    filters: opts.filters,
  };
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await fs.promises.writeFile(result.filePath, opts.buffer);
  return result.filePath;
}

/**
 * Ask where to save, then copy an existing file (used for run videos).
 * Returns the chosen path, or null if the user cancelled.
 */
export async function pickAndCopyFile(opts: {
  defaultFilename: string;
  filters: { name: string; extensions: string[] }[];
  sourcePath: string;
}): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  const options = {
    defaultPath: path.join(app.getPath('downloads'), opts.defaultFilename),
    filters: opts.filters,
  };
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return null;
  await fs.promises.copyFile(opts.sourcePath, result.filePath);
  return result.filePath;
}
