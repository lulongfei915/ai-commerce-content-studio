import { apiFetch } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

type Schema = components['schemas'];
export type Task = Schema['TaskResponse'];
export type Purpose = Schema['PositionResponse']['purpose'];
export const purposeLabel: Record<Purpose, string> = {
  main: '主图',
  detail: '详情素材',
  video: '带货视频',
};
export const purposes: Purpose[] = ['main', 'detail', 'video'];

export function listTasks(query: string, cursor: string | null, signal: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  if (cursor) params.set('cursor', cursor);
  return apiFetch<Schema['TaskList']>(`/tasks?${params}`, { signal });
}

export function getTask(id: string, signal?: AbortSignal) {
  return apiFetch<Task>(`/tasks/${encodeURIComponent(id)}`, { signal });
}

function mutateTask<T>(path: string, method: 'POST' | 'PATCH', body: T, token: string) {
  return apiFetch<Task>(path, {
    method,
    headers: { 'X-CSRF-Token': token },
    body: JSON.stringify(body),
  });
}

export function createTask(body: Schema['TaskCreate'], token: string) {
  return mutateTask('/tasks', 'POST', body, token);
}

export function addTaskProducts(task: Task, productIds: string[], token: string) {
  const body: Schema['TaskProductAdd'] = {
    expected_version: task.version,
    product_ids: productIds,
  };
  return mutateTask(`/tasks/${encodeURIComponent(task.id)}/products`, 'POST', body, token);
}

export function updateTask(task: Task, name: string, token: string) {
  const body: Schema['TaskUpdate'] = { expected_version: task.version, name };
  return mutateTask(`/tasks/${encodeURIComponent(task.id)}`, 'PATCH', body, token);
}
