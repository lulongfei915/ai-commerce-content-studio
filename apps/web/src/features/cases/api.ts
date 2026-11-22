import { apiFetch, apiPrefix, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

type Schema = components['schemas'];
export type CreativeCase = Schema['CaseView'];
export type UsagePurpose = NonNullable<Schema['CaseLicense']['usage_purposes']>[number];
export type CaseInput = Schema['CaseCreate'];
export function listCases(
  q: string,
  cursor: string | null,
  signal: AbortSignal,
  category: string,
  media: string,
) {
  const params = new URLSearchParams({ q });
  if (cursor) params.set('cursor', cursor);
  if (category) params.set('category', category);
  if (media) params.set('media', media);
  return apiFetch<Schema['CasePage']>(`/cases?${params}`, { signal });
}
export function saveCase(token: string, data: CaseInput) {
  return apiWrite<CreativeCase>('/cases', token, data);
}
export function licenseCase(
  token: string,
  item: CreativeCase,
  usage_scope: string | null,
  usage_purposes: UsagePurpose[],
) {
  return apiWrite<CreativeCase>(
    `/cases/${item.id}`,
    token,
    { usage_scope, usage_purposes, expected_version: item.version },
    'PATCH',
  );
}
export function casePreview(id: string) {
  return `${apiPrefix}/cases/${id}/preview`;
}
