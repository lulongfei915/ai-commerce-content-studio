import type { Session } from '../auth/session';

export type CreationEntry = 'quick' | 'canvas' | 'batch';

type RecentTask = { id: string; name: string };
const recentLimit = 6;

function key(session: Session, setting: 'entry' | 'task' | 'recent-tasks') {
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

export function readRecentTasks(session: Session): RecentTask[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key(session, 'recent-tasks')) ?? '[]');
    if (!Array.isArray(stored)) return [];
    return stored.filter((task): task is RecentTask =>
      typeof task?.id === 'string' && typeof task?.name === 'string',
    ).slice(0, recentLimit);
  } catch {
    return [];
  }
}

export function rememberTask(session: Session, { id, name }: RecentTask) {
  try {
    localStorage.setItem(key(session, 'task'), id);
    const recent = readRecentTasks(session).filter((task) => task.id !== id);
    localStorage.setItem(key(session, 'recent-tasks'), JSON.stringify([{ id, name }, ...recent].slice(0, recentLimit)));
  } catch {
    // Navigation still works for this session.
  }
}
