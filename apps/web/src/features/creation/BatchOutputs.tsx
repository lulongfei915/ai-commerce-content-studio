import { useEffect, useState } from 'react';
import { ClockCircleOutlined, ExclamationCircleOutlined, LoadingOutlined, PlayCircleOutlined } from '@ant-design/icons';

import type { Session } from '../auth/session';
import { statusLabel } from '../canvas/status';
import { purposeLabel, type Task } from '../tasks/api';
import { type Draft } from './api';
import { AssetDetailDrawer } from '../tasks/AssetDetailDrawer';
import { BatchExecutionRecord } from './BatchExecutionRecord';
import { resultPreview, type TaskResult } from './results';
import type { BatchExecution } from './useBatchProgress';
import { activeImageStatuses, archivedImageStatuses, canRetryExecution, executionStatus } from './useImageExecution';
import './batch-results.css';

export function BatchOutputs({
  row, draft, task, session, busy, results, resultsError, refreshResults, onAction,
}: {
  row: BatchExecution;
  draft: Draft;
  task: Task;
  session: Session;
  busy: boolean;
  results?: TaskResult[];
  resultsError: boolean;
  refreshResults: () => void;
  onAction: (path: string) => void;
}) {
  const [selected, setSelected] = useState<TaskResult>();
  const [showRecord, setShowRecord] = useState(false);
  const job = row.execution;
  const product = task.products.find((item) => item.id === draft.product_id);
  const byOutput = new Map(results?.filter((asset) => asset.execution_id === job.id)
    .map((asset) => [asset.version_id, asset]));
  const archived = job.outputs.filter(({ status }) => archivedImageStatuses.has(status));
  const missing = archived.filter(({ id }) => !byOutput.has(id)).map(({ id }) => id).join(',');
  const canCreate = session.permissions.includes('create');
  const media = job.media === 'image' ? '图片' : '视频';
  const purpose = task.positions.find((position) => position.id === draft.batch_position_id)?.module
    || purposeLabel[draft.purpose];

  // Progress polling and the result list can finish out of order when an output is archived.
  useEffect(() => {
    if (!missing || resultsError) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      refreshResults();
      if (++attempts === 3) window.clearInterval(timer);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [missing, resultsError, refreshResults]);

  return (
    <>
      <p className="batch-output-summary">
        {[product?.name, purpose, `${archived.length}/${job.outputs.length} 份完成`].filter(Boolean).join(' · ')}
      </p>
      <ul className="batch-outputs" aria-label="逐份进度">
        {job.outputs.map((output, index) => {
          const asset = byOutput.get(output.id);
          const preview = asset?.previewable && asset.file_version
            ? resultPreview(asset.task_id, asset.version_id, asset.file_version, asset.version) : undefined;
          const retryable = canRetryExecution(job.media, output);
          const running = activeImageStatuses.has(output.status);
          const failed = retryable || ['generation_failed', 'result_unavailable', 'unknown'].includes(output.status);
          const status = asset?.status ?? output.status;
          return (
            <li key={output.id} className="batch-output">
              {asset && preview && asset.media === 'image' ? (
                <button className="batch-output-preview" type="button" onClick={() => setSelected(asset)}
                  aria-label={`预览第 ${index + 1} 份${media}`}>
                  <img src={preview} alt={asset.label} />
                </button>
              ) : (
                <div className="batch-output-placeholder">
                  {failed ? <ExclamationCircleOutlined /> : asset && job.media === 'video' ? <PlayCircleOutlined />
                    : running && output.status !== 'queued' ? <LoadingOutlined /> : <ClockCircleOutlined />}
                  <span>{output.status === 'save_failed' ? '生成结果已保留' : `第 ${index + 1} 份输出`}</span>
                </div>
              )}
              <div className="batch-output-caption">
                <span className="review-dialog-status" data-status={failed ? 'rejected' : status}>
                  {asset ? statusLabel[status] ?? status : executionStatus(job.media, output)}
                </span>
                {asset && <button className="batch-plain" type="button" onClick={() => setSelected(asset)}>预览与审核</button>}
                {canCreate && retryable && (
                  <button className="batch-plain" type="button" disabled={busy} onClick={() => onAction(`/outputs/${output.id}/retry`)}>
                    {output.status === 'save_failed' ? '只重存' : '重试此输出'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(resultsError || missing) && (
        <div className="batch-output-tools">
          <small role={resultsError ? 'alert' : 'status'}>{resultsError ? '作品未加载' : '作品正在同步'}</small>
          <button type="button" className="batch-plain" onClick={refreshResults}>刷新作品</button>
        </div>
      )}
      {canCreate && job.outputs.some((item) => item.status === 'queued') && (
        <button type="button" className="batch-plain" disabled={busy} onClick={() => onAction(`/executions/${job.id}/cancel`)}>
          取消未发出
        </button>
      )}
      <button type="button" className="batch-plain" onClick={() => setShowRecord(true)}>
        <ClockCircleOutlined aria-hidden="true" /> 输入与执行记录
      </button>
      {showRecord && <BatchExecutionRecord sku={product?.sku}
        path={`/tasks/${task.id}/batches/${job.media}/executions/${job.id}/record`}
        onClose={() => setShowRecord(false)} />}
      {selected && <AssetDetailDrawer item={selected} task={task} session={session}
        refresh={refreshResults} onClose={() => setSelected(undefined)} />}
    </>
  );
}
