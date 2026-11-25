import { useState } from 'react';
import { ExclamationCircleOutlined, PictureOutlined } from '@ant-design/icons';
import { statusLabel } from '../canvas/status';
import { actionError } from '../creation/api';
import {
  activeImageStatuses,
  archivedImageStatuses,
  type ImageExecution,
} from '../creation/useImageExecution';

type Job = NonNullable<ImageExecution['job']>;
type Output = Job['outputs'][number];

export type ImageSlot = {
  id: string;
  index: number;
  work?: { owner: string; job: Job; output: Output };
};

export function StudioImagePlaceholder({
  slot,
  disabled,
  update,
}: {
  slot: ImageSlot;
  disabled: boolean;
  update?: ImageExecution['update'];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const work = slot.work;
  const output = work?.output;
  const archived = output && archivedImageStatuses.has(output.status);
  const loading = !output || archived || activeImageStatuses.has(output.status);
  const retryable = output?.status === 'generation_failed' || output?.status === 'save_failed';
  const canCancel =
    work && work.job.outputs.find((item) => item.status === 'queued')?.id === slot.id;
  const label = !output
    ? '提交中'
    : archived
      ? '载入图片中'
      : output.error === 'result_size_mismatch'
        ? `尺寸不符${output.result_size ? `（${output.result_size.replace('x', '×')}）` : ''}`
        : (statusLabel[output.status] ?? output.status);

  async function run(path: string) {
    if (!work || !update) return;
    setBusy(true);
    setError('');
    try {
      await update(path, work.owner);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="studio-art studio-art-placeholder" data-loading={loading} aria-hidden="true">
        <PictureOutlined />
      </div>
      <span className="studio-type">
        <PictureOutlined /> 图片
      </span>
      <footer>
        <b>图片 {slot.index + 1}</b>
        <div>
          <span role="status" data-failed={!loading && output?.status !== 'cancelled'}>
            {label}
          </span>
          {canCancel && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void run(`/executions/${work.job.id}/cancel`)}
            >
              取消排队
            </button>
          )}
          {retryable && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void run(`/outputs/${slot.id}/retry`)}
            >
              重试该步骤
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="work-error">
            <ExclamationCircleOutlined aria-hidden="true" /> {error}
          </p>
        )}
      </footer>
    </>
  );
}
