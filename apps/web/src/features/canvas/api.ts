import { apiFetch, apiPrefix, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

type Schema = components['schemas'];
export type Canvas = Schema['CanvasView'];
export type CanvasNode = Schema['CanvasNode'];
export type Positions = NonNullable<Schema['LayoutView']['positions']>;
export type Viewport = Omit<Schema['ViewportView'], 'version'>;

const path = (task: string) => `/tasks/${encodeURIComponent(task)}/canvas`;

export function getCanvas(task: string, signal?: AbortSignal) {
  return apiFetch<Canvas>(path(task), { signal });
}

export function putLayout(
  task: string,
  token: string,
  expected_version: number,
  positions: Positions,
) {
  return apiWrite<Schema['LayoutView']>(
    `${path(task)}/layout`,
    token,
    { expected_version, positions },
    'PUT',
  );
}

export function putViewport(task: string, token: string, expected_version: number, view: Viewport) {
  return apiWrite<Schema['ViewportView']>(
    `${path(task)}/viewport`,
    token,
    { expected_version, ...view },
    'PUT',
  );
}

export function nodePreview(task: string, id: string, fileVersion: number, sourceVersion?: number) {
  const params = new URLSearchParams({ file_version: String(fileVersion) });
  if (sourceVersion) params.set('source_version', String(sourceVersion));
  return `${apiPrefix}${path(task)}/preview/${encodeURIComponent(id)}?${params}`;
}
