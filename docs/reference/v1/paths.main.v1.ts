import * as path from 'path';
import { app } from 'electron';

export function getDataDir(): string {
  if (app.isPackaged) {
    // Production: data folder next to the executable
    return path.join(path.dirname(app.getPath('exe')), 'data');
  } else {
    // Development: data folder in project root
    return path.join(process.cwd(), 'data');
  }
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'notes.db');
}

export function getNotesDir(): string {
  return path.join(getDataDir(), 'notes');
}
