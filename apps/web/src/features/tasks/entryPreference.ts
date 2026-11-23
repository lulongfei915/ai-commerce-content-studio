import type { Session } from '../auth/session';

export type CreationEntry = 'quick' | 'canvas' | 'batch';

function key(session: Session, setting: 'entry' | 'task') {
  return `zaowu-studio-${setting}:${session.tenant.id}:${session.user_id}`;
}

export function readEntry(session: Session): CreationEntry {
  try {
    const entry = localStorage.getItem(key(session, 'entry'));
    if (entry === 'canvas' && session.permissions.includes('view')) return 'canvas';
    if (entry === 'batch' && session.permissions.includes('create')) return 'batch';
  } catch {
    // Browser storage can be disabled.
  }
  return 'quick';
}

export function rememberEntry(session: Session, entry: CreationEntry) {
  try {
    localStorage.setItem(key(session, 'entry'), entry);
  } catch {
    // Navigation still works for this session.
  }
}

export function readTaskPreference(session: Session) {
  try {
    return localStorage.getItem(key(session, 'task'));
  } catch {
    return null;
  }
}

export function rememberTask(session: Session, id: string) {
  try {
    localStorage.setItem(key(session, 'task'), id);
  } catch {
    // Navigation still works for this session.
  }
}
