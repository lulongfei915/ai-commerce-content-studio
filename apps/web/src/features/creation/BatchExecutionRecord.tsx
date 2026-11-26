import { useEffect, useState } from 'react';

import { apiFetch } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { Modal } from '../../shared/ui/Modal';
import { purposeLabel } from '../tasks/api';
import { executionStatus } from './useImageExecution';

type RecordView = components['schemas']['BatchExecutionRecord'];

export function BatchExecutionRecord({ path, sku, onClose }: {
  path: string;
  sku?: string;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<RecordView>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void apiFetch<RecordView>(path, { signal: request.signal })
      .then((data) => {
        if (!request.signal.aborted) setRecord(data);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      });
    return () => request.abort();
  }, [path, retry]);
  const draft = record?.inputs.draft;
  const parameters = draft?.video_parameters ?? draft?.parameters;

  return (
    <Modal title="生成项 · 输入与执行记录" onClose={onClose} className="batch-record">
      {error ? (
        <p role="alert" className="work-error">
          执行记录未加载。{' '}
          <button type="button" onClick={() => {
            setError(false);
            setRetry((n) => n + 1);
          }}>重试</button>
        </p>
      ) : !record || !draft ? <p role="status">正在读取执行记录…</p> : (
        <>
          <dl>
            <dt>执行编号</dt><dd>{record.execution.id}</dd>
            <dt>提交时间</dt><dd>{new Date(record.submitted_at).toLocaleString('zh-CN')}</dd>
            <dt>商品 / 用途</dt><dd>{[sku, purposeLabel[draft.purpose]].filter(Boolean).join(' · ')}</dd>
            <dt>提交配置</dt><dd>{parameters && [parameters.model, parameters.ratio, parameters.resolution,
              draft.video_parameters && `${draft.video_parameters.duration} 秒`].filter(Boolean).join(' · ')}</dd>
            <dt>提示词快照</dt><dd className="batch-record-prompt">{draft.prompt}</dd>
            <dt>参考快照</dt><dd>{[
              record.inputs.product_photos.length ? `${record.inputs.product_photos.length} 张商品实拍` : '',
              ...record.inputs.references.map((entry) => entry.label),
            ].filter(Boolean).join(' · ') || '无参考'}</dd>
          </dl>
          <ol aria-label="输出执行状态">
            {record.execution.outputs.map((output) => (
              <li key={output.id}>{executionStatus(record.execution.media, output)}</li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}
