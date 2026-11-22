import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';

type Schema = components['schemas'];
export type Template = Schema['TemplateView'];
export type TemplateContent = Schema['TemplateContent'];
export function listTemplates(
  manage: boolean,
  cursor: string | null,
  signal: AbortSignal,
  category?: string,
  purpose?: string,
) {
  const query = new URLSearchParams({ manage: String(manage) });
  if (cursor) query.set('cursor', cursor);
  if (category) query.set('category', category);
  if (purpose) query.set('purpose', purpose);
  return apiFetch<Schema['TemplatePage']>(`/templates?${query}`, { signal });
}
export function writeTemplate(token: string, content: TemplateContent, item?: Template) {
  return item
    ? apiWrite<Template>(
        `/templates/${item.id}`,
        token,
        { ...content, expected_version: item.version },
        'PATCH',
      )
    : apiWrite<Template>('/templates', token, content);
}
export function templateAction(token: string, item: Template, action: 'publish' | 'status') {
  return apiWrite<Template>(`/templates/${item.id}/${action}`, token, {
    expected_version: item.version,
    ...(action === 'status' ? { enabled: !item.enabled } : {}),
  });
}
export function loadTemplateVersion(id: string, version: number, signal?: AbortSignal) {
  return apiFetch<TemplateContent>(`/templates/${id}/versions/${version}`, { signal });
}
