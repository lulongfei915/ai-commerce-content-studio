import { apiFetch, apiPrefix } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

export type TaskResult = components['schemas']['TaskResult'];

const path = (task: string) => `/tasks/${encodeURIComponent(task)}/results`;

export function getTaskResults(task: string, signal: AbortSignal) {
  return apiFetch<TaskResult[]>(path(task), { signal });
}

export function resultPreview(
  task: string,
  versionId: string,
  fileVersion: number,
  resultVersion?: number,
) {
  const params = new URLSearchParams({ file_version: String(fileVersion) });
  if (resultVersion) params.set('source_version', String(resultVersion));
  return `${apiPrefix}${path(task)}/${encodeURIComponent(versionId)}/preview?${params}`;
}
