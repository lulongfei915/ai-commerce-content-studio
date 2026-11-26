import type { Draft } from './api';

export function batchPrompt(draft: Draft) {
  return draft.prompt.trim().replace(/\s+/g, ' ') || '未填写提示词';
}

export function batchItemTitle(draft: Draft, index: number) {
  return `${String(index + 1).padStart(2, '0')} · ${batchPrompt(draft)}`;
}
