import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { statusLabel } from '../canvas/status';
import type { Draft } from './api';

type Job = components['schemas']['ExecutionState'];
type Output = Job['outputs'][number];
const videoErrors: Record<string, string> = {
  invalid_request: 'Seedance 拒绝了请求，请检查提示词和参考素材',
  authentication: 'Seedance 鉴权失败，请联系管理员',
  configuration: '尚未配置 Seedance API Key',
  input_unavailable: '参考素材不可用，请重新检查生成输入',
  rate_limited: 'Seedance 调用频繁，请稍后重试',
  video_provider_failed: 'Seedance 生成失败',
  video_provider_cancelled: 'Seedance 已取消任务',
  video_provider_expired: 'Seedance 任务已过期',
};

export function executionStatus(media: Job['media'], output: Output) {
  if (output.error === 'result_size_mismatch')
    return `尺寸不符${output.result_size ? `（${output.result_size.replace('x', '×')}）` : ''}`;
  if (media === 'video' && output.status === 'generation_failed' && output.error) {
    const message = videoErrors[output.error];
    if (message) return message;
  }
  return statusLabel[output.status] ?? output.status;
}

export function canRetryExecution(media: Job['media'], output: Output) {
  return (
    output.status === 'save_failed' ||
    (output.status === 'generation_failed' &&
      (media !== 'video' || (!output.provider_id && output.actual_cents === 0)))
  );
}

export const activeImageStatuses = new Set(['queued', 'generating', 'saving']);
export const archivedImageStatuses = new Set([
  'pending_review',
  'needs_review',
  'approved',
  'rejected',
]);

export function useImageExecution(
  draft: Draft | undefined,
  token: string,
  taskId = draft?.task_id,
  positionId?: string,
) {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const latestJobs = useRef(jobs);
  const request = useRef<{ id: string; version: number; key: string; position?: string }>();
  const draftId = draft?.id;
  const job = draftId ? jobs[draftId] : undefined;
  const inProgress = Boolean(job?.outputs.some((output) => activeImageStatuses.has(output.status)));
  const hasActiveJobs = Object.values(jobs).some((item) =>
    item.outputs.some((output) => activeImageStatuses.has(output.status)),
  );

  useEffect(() => {
    latestJobs.current = jobs;
  }, [jobs]);

  useEffect(() => {
    if (!draftId) return;
    const ctl = new AbortController();
    void apiFetch<Job[]>(`/creations/${draftId}/executions`, { signal: ctl.signal })
      .then(([latest]) => {
        if (!ctl.signal.aborted && latest)
          setJobs((current) => (current[draftId] ? current : { ...current, [draftId]: latest }));
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [draftId]);

  useEffect(() => {
    if (!hasActiveJobs) return;
    const ctl = new AbortController();
    const polling = new Set<string>();
    const timer = window.setInterval(() => {
      for (const [owner, currentJob] of Object.entries(latestJobs.current)) {
        if (
          polling.has(currentJob.id) ||
          !currentJob.outputs.some((output) => activeImageStatuses.has(output.status))
        )
          continue;
        polling.add(currentJob.id);
        void apiFetch<Job>(`/executions/${currentJob.id}`, { signal: ctl.signal })
          .then((next) => {
            if (ctl.signal.aborted || latestJobs.current[owner] !== currentJob) return;
            setJobs((current) =>
              current[owner] === currentJob ? { ...current, [owner]: next } : current,
            );
            const newlyArchived = next.outputs.some(
              (output) =>
                archivedImageStatuses.has(output.status) &&
                currentJob.outputs.some(
                  (old) => old.id === output.id && activeImageStatuses.has(old.status),
                ),
            );
            if (
              newlyArchived ||
              !next.outputs.some((output) => activeImageStatuses.has(output.status))
            )
              window.dispatchEvent(new CustomEvent('studio-results', { detail: taskId }));
          })
          .catch(() => {})
          .finally(() => polling.delete(currentJob.id));
      }
    }, 2000);
    return () => {
      clearInterval(timer);
      ctl.abort();
    };
  }, [taskId, hasActiveJobs]);

  async function submit(input: Draft) {
    const position = input.purpose !== 'video' ? positionId : undefined;
    if (request.current?.id !== input.id || request.current.version !== input.version ||
      request.current.position !== position) {
      request.current = { id: input.id, version: input.version, key: crypto.randomUUID(), position };
    }
    const pending = request.current;
    const next = await apiWrite<Job>(`/creations/${input.id}/executions`, token, {
      expected_version: input.version,
      idempotency_key: pending.key,
      position_id: position,
    });
    setJobs((current) => ({
      [input.id]: next,
      ...Object.fromEntries(Object.entries(current).filter(([id]) => id !== input.id)),
    }));
    if (request.current === pending) request.current = undefined;
  }

  async function update(path: string, owner = draftId) {
    if (!owner) return;
    const next = await apiWrite<Job>(path, token);
    setJobs((current) => ({ ...current, [owner]: next }));
    if (next.media === 'video')
      window.dispatchEvent(new CustomEvent('studio-results', { detail: taskId }));
  }

  return { job, jobs, inProgress, submit, update };
}

export type ImageExecution = ReturnType<typeof useImageExecution>;
