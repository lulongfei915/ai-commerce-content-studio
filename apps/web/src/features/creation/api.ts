import { ApiError, apiFetch, apiWrite } from '../../shared/api/client';
import { uploadMedia } from '../../shared/api/upload';
import type { components } from '../../shared/api/generated';

type Schema = components['schemas'];
export type Draft = Schema['CreationView'];
export type Parameters = Schema['ImageParameters'];
export type Capabilities = Schema['Capabilities'];
export type Issue = Schema['FieldIssue'];
export type Reference = Schema['ReferenceView'];
export type VideoParameters = Schema['VideoParameters'];
export type ReferenceUsage = Reference['usage'];
export const usageLabel: Record<NonNullable<ReferenceUsage>, string> = {
  product: '商品实拍',
  expression: '风格参考',
  composition: '构图参考',
  lighting: '光影参考',
  first_frame: '首帧',
  last_frame: '尾帧',
};
export const defaults: Parameters = {
  model: 'seedream-5.5',
  ratio: '1:1',
  resolution: '1K',
  count: 1,
};

export function loadCapabilities(signal: AbortSignal) {
  return apiFetch<Capabilities>('/creation-capabilities', { signal });
}
export function listDrafts(
  task: string,
  signal: AbortSignal,
  entry: NonNullable<Draft['entry']> = 'quick',
) {
  return apiFetch<Draft[]>(`/tasks/${task}/creations?entry=${entry}&primary=false`, { signal });
}
export function createDraft(
  task: string,
  product_id: string,
  purpose: Draft['purpose'],
  token: string,
  primary = true,
  entry: NonNullable<Draft['entry']> = 'quick',
) {
  return apiWrite<Draft>(`/tasks/${task}/creations`, token, {
    product_id,
    purpose,
    primary,
    entry,
  });
}
export function draftWrite(
  draft: Draft,
  token: string,
  suffix: string,
  body: object,
  method = 'POST',
) {
  return apiWrite<Draft>(
    `/creations/${draft.id}${suffix}`,
    token,
    { expected_version: draft.version, ...body },
    method,
  );
}
export function removeReference(draft: Draft, token: string, id: string) {
  return apiWrite<Draft>(
    `/creations/${draft.id}/references/${id}?expected_version=${draft.version}`,
    token,
    undefined,
    'DELETE',
  );
}
export async function uploadReference(draft: Draft, token: string, file: File) {
  const source_id = await uploadMedia(file, token);
  return draftWrite(draft, token, '/references', { kind: 'upload', source_id });
}
export function checkDraft(draft: Draft, signal?: AbortSignal) {
  return apiFetch<Schema['Readiness']>(`/creations/${draft.id}/readiness`, { signal });
}
export function loadSnapshot(draft: Draft) {
  return apiFetch<Schema['InputSnapshot']>(`/creations/${draft.id}/input-snapshot`);
}

const messages: Record<string, string> = {
  template_disabled: '模板已停用，请重新选择模板或取消应用。',
  template_incompatible: '模板与当前商品品类或用途不匹配。',
  case_not_licensed: '案例尚未授权生产。',
  case_incompatible: '案例的品类或媒体类型不匹配。',
  reference_not_ready: '文件尚未就绪或不可用。',
  reference_version_invalid: '来源或授权版本已变化，请重新选择参考。',
  reference_other_sku: '该实拍属于其他 SKU。',
  reference_duplicate: '该文件已被引用。',
  reference_limit: '输入图片合计不能超过 10 张。',
  reference_cycle: '该连接会形成循环依赖。',
  reference_result_required: '请选择已批准的结果版本作为参考。',
  reference_usage_unsupported: '当前来源不支持所选用途。',
  reference_usage_duplicate: '首帧或尾帧只能使用一个参考。',
  reference_label_dangling: '提示词含已移除的引用标签，请删除或重新插入。',
  canvas_node_unknown: '画布中的某个素材已不可用。',
  reference_media_unsupported: '参考需为 10 MB 以内的 JPG、PNG 或 WebP。',
  model_unsupported: '当前模型不可用。',
  ratio_unsupported: '当前模型不支持该比例。',
  resolution_unsupported: '当前模型不支持此比例和清晰度组合。',
  output_count_unsupported: '输出张数超出当前规格或参考图数量限制。',
  prompt_required: '请填写提示词。',
  product_inputs_incomplete: '请补齐该 SKU 的对应商品资料。',
  version_conflict: '此记录已更新。请先复制当前编辑内容，再重新打开。',
  draft_incompatible: '请选择同用途的快捷或画布草稿。',
};
export function issueText(issue: Issue) {
  return `${issue.field} · ${messages[issue.code] ?? '请核对该字段。'}`;
}
export function actionError(error: unknown) {
  if (error instanceof ApiError && error.code)
    return error.field
      ? issueText({ field: error.field, code: error.code })
      : (messages[error.code] ?? '操作未完成，请核对资料后重试。');
  return error instanceof Error && !(error instanceof ApiError)
    ? error.message
    : '操作未完成，请重试。';
}
