import { apiDelete, apiFetch } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

export type Session = components['schemas']['CurrentSession'];
export type Credentials = components['schemas']['Credentials'];

export const roleLabel: Record<Session['role'], string> = {
  admin: '管理员', designer: '设计师', reviewer: '审核员', viewer: '只读成员',
};

export function getSession(signal: AbortSignal): Promise<Session> {
  return apiFetch('/me', { signal });
}

export function signIn(credentials: Credentials): Promise<Session> {
  return apiFetch('/sessions', {
    method: 'POST', headers: { 'X-Studio-Login': '1' }, body: JSON.stringify(credentials),
  });
}

export function signOut(session: Session): Promise<void> {
  return apiDelete('/sessions/current', session.csrf_token);
}
