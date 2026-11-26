import { useEffect, useState } from 'react';

import { checkDraft, issueText, type Draft, type Issue } from './api';
import type { BatchExecution } from './useBatchProgress';
import {
  archivedImageStatuses,
  canRetryExecution,
  executionStatus,
} from './useImageExecution';

export function BatchReadiness({ draft }: { draft: Draft }) {
  const [issues, setIssues] = useState<Issue[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    void checkDraft(draft, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setIssues(value.issues);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      });
    return () => request.abort();
  }, [draft]);
  const first = issues?.[0];
  const label = error ? '核对未完成' : first ? issueText(first) : issues ? '输入已核对' : '正在核对输入…';
  return <small title={issues?.map(issueText).join(' · ')}>{label}</small>;
}

export function BatchOutputs({
  row,
  busy,
  canCreate,
  onAction,
  onOpen,
}: {
  row: BatchExecution;
  busy: boolean;
  canCreate: boolean;
  onAction: (path: string) => void;
  onOpen: (id: string) => void;
}) {
  const job = row.execution;
  return (
    <ul className="batch-outputs" aria-label="逐份进度">
      {job.outputs.map((output, index) => (
        <li key={output.id}>
          <span>{index + 1}. {executionStatus(job.media, output)}</span>
          {archivedImageStatuses.has(output.status) && (
            <button onClick={() => onOpen(output.id)}>查看作品</button>
          )}
          {canCreate && canRetryExecution(job.media, output) && (
            <button disabled={busy} onClick={() => onAction(`/outputs/${output.id}/retry`)}>
              恢复此份
            </button>
          )}
        </li>
      ))}
      {canCreate && job.outputs.some((item) => item.status === 'queued') && (
        <li>
          <button disabled={busy} onClick={() => onAction(`/executions/${job.id}/cancel`)}>
            取消未发出
          </button>
        </li>
      )}
    </ul>
  );
}
