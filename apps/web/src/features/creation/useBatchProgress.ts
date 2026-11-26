import { useEffect, useState } from 'react';

import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { activeImageStatuses } from './useImageExecution';

export type BatchExecution = components['schemas']['ItemExecution'];
export type BatchConfig = components['schemas']['PublicState'];

export function useBatchProgress(path: string, taskId: string, token: string) {
  const [snapshot, setSnapshot] = useState<{ path: string; rows: BatchExecution[] }>();
  const [failedPath, setFailedPath] = useState('');
  const [revision, setRevision] = useState(0);
  const rows = snapshot?.path === path ? snapshot.rows : undefined;
  const active = Boolean(rows?.some(({ execution }) =>
    execution.outputs.some(({ status }) => activeImageStatuses.has(status)),
  ));
  useEffect(() => {
    const request = new AbortController();
    let timer: number | undefined;
    const load = () => {
      void apiFetch<BatchExecution[]>(`${path}/executions`, { signal: request.signal })
        .then((next) => {
          if (request.signal.aborted) return;
          setFailedPath('');
          setSnapshot({ path, rows: next });
          if (active) window.dispatchEvent(new CustomEvent('studio-results', { detail: taskId }));
        })
        .catch(() => {
          if (!request.signal.aborted) setFailedPath(path);
        })
        .finally(() => {
          if (!request.signal.aborted && active) timer = window.setTimeout(load, 2000);
        });
    };
    if (active) timer = window.setTimeout(load, 1200);
    else load();
    return () => {
      request.abort();
      window.clearTimeout(timer);
    };
  }, [path, taskId, active, revision]);

  function update(next: BatchExecution[]) {
    setSnapshot((previous) => ({
      path,
      rows: [
        ...(previous?.path === path ? previous.rows : []).filter(
          (old) => !next.some((row) => row.item_id === old.item_id),
        ),
        ...next,
      ],
    }));
  }

  async function outputAction(itemId: string, suffix: string) {
    const execution = await apiWrite<BatchExecution['execution']>(suffix, token);
    update([{ item_id: itemId, execution }]);
  }

  return { rows, failed: failedPath === path, reload: () => setRevision((n) => n + 1), update, outputAction };
}
