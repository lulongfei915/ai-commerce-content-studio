import { useEffect, useRef, useState } from 'react';
import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import type { Draft } from './api';

type Job = components['schemas']['ExecutionState'];
const active = new Set(['queued', 'generating', 'saving']);

export function useImageExecution(draft: Draft | undefined, token: string) {
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const request = useRef<{ id: string; version: number; key: string }>();
  const draftId = draft?.id;
  const taskId = draft?.task_id;
  const job = draftId ? jobs[draftId] : undefined;
  const inProgress = Boolean(job?.outputs.some((output) => active.has(output.status)));

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
    if (!job || !inProgress || !draftId) return;
    const ctl = new AbortController();
    const timer = window.setInterval(() => {
      void apiFetch<Job>(`/executions/${job.id}`, { signal: ctl.signal })
        .then((next) => {
          if (ctl.signal.aborted) return;
          setJobs((current) =>
            current[draftId]?.id === job.id ? { ...current, [draftId]: next } : current,
          );
          if (!next.outputs.some((output) => active.has(output.status)))
            window.dispatchEvent(new CustomEvent('studio-results', { detail: taskId }));
        })
        .catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      ctl.abort();
    };
  }, [draftId, taskId, job, inProgress]);

  async function submit(input: Draft) {
    if (request.current?.id !== input.id || request.current.version !== input.version) {
      request.current = { id: input.id, version: input.version, key: crypto.randomUUID() };
    }
    const pending = request.current;
    const next = await apiWrite<Job>(`/creations/${input.id}/executions`, token, {
      expected_version: input.version,
      idempotency_key: pending.key,
    });
    setJobs((current) => ({ ...current, [input.id]: next }));
    if (request.current === pending) request.current = undefined;
  }

  async function update(path: string) {
    if (!draftId) return;
    const next = await apiWrite<Job>(path, token);
    setJobs((current) => ({ ...current, [draftId]: next }));
  }

  return { job, inProgress, submit, update };
}

export type ImageExecution = ReturnType<typeof useImageExecution>;
