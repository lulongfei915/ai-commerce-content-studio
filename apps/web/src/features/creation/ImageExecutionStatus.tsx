import { useState } from 'react';
import { statusLabel } from '../canvas/status';
import { actionError } from './api';
import type { ImageExecution } from './useImageExecution';

export function ImageExecutionStatus({
  execution,
  disabled,
}: {
  execution: ImageExecution;
  disabled: boolean;
}) {
  const { job, update } = execution;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!job?.outputs.length) return null;
  const canCancel = job.outputs.some((output) => output.status === 'queued');

  async function run(path: string) {
    setBusy(true);
    setError('');
    try {
      await update(path);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="image-execution">
      <ul aria-live="polite">
        {job.outputs.map((output, index) => (
          <li key={output.id}>
            <span className="image-output-status" data-status={output.status}>
              图片 {index + 1} · {statusLabel[output.status] ?? output.status}
            </span>
            {['generation_failed', 'save_failed'].includes(output.status) && (
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => void run(`/outputs/${output.id}/retry`)}
              >
                重试该步骤
              </button>
            )}
          </li>
        ))}
      </ul>
      {canCancel && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void run(`/executions/${job.id}/cancel`)}
        >
          取消排队
        </button>
      )}
      {error && (
        <p className="work-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
