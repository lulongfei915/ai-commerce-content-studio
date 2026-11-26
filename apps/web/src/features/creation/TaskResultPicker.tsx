import { useEffect, useState } from 'react';
import { LinkOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';

import { statusLabel } from '../canvas/status';
import type { Task } from '../tasks/api';
import { getTaskResults, resultPreview, type TaskResult } from './results';
import './task-result-picker.css';

export function TaskResultPicker({
  task,
  sku,
  canPlayVideo,
  shownVersions,
  onReference,
  referenceLabel = '引用到画布',
  busy = false,
  initialVersion,
}: {
  task: Task;
  sku: string;
  canPlayVideo: boolean;
  shownVersions: ReadonlySet<string>;
  onReference?: (result: TaskResult) => void;
  referenceLabel?: string;
  busy?: boolean;
  initialVersion?: string;
}) {
  const [items, setItems] = useState<TaskResult[]>();
  const [selected, setSelected] = useState(initialVersion);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const result = items?.find((item) => item.version_id === selected);
  const src =
    result?.previewable && result.file_version
      ? resultPreview(task.id, result.version_id, result.file_version, result.version)
      : undefined;

  useEffect(() => {
    const controller = new AbortController();
    void getTaskResults(task.id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setItems(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [task.id, retry]);

  if (error) {
    return (
      <p role="alert">
        任务作品未加载。{' '}
        <button
          type="button"
          onClick={() => {
            setError(false);
            setRetry((n) => n + 1);
          }}
        >
          重试
        </button>
      </p>
    );
  }
  if (!items) return <p role="status">正在读取任务作品…</p>;
  if (!items.length) return <p className="work-muted">暂无任务作品</p>;
  return (
    <div className="task-result-picker">
      <ul aria-label="任务作品">
        {items.map((item) => (
          <li key={item.version_id} data-asset-id={item.asset_id} data-version-id={item.version_id}>
            <button
              type="button"
              aria-pressed={selected === item.version_id}
              onClick={() => setSelected(item.version_id)}
            >
              {item.media === 'video' ? <VideoCameraOutlined /> : <PictureOutlined />}
              <span>
                {task.products.find((product) => product.id === item.product_id)?.sku}
                {' · '}
                {item.label} · V{item.version}
              </span>
              <small>{statusLabel[item.status] ?? item.status}</small>
            </button>
          </li>
        ))}
      </ul>
      {result && (
        <div className="task-result-preview" aria-label="作品预览">
          {src && result.media === 'image' && <img src={src} alt={result.label} />}
          {src && result.media === 'video' && canPlayVideo && (
            <video src={src} preload="none" controls aria-label={result.label} />
          )}
          {(!src || (result.media === 'video' && !canPlayVideo)) && <p>预览不可用</p>}
          {onReference && (
            <footer className="work-actions">
              <button
                type="button"
                className="work-primary"
                disabled={
                  busy ||
                  !result.referenceable ||
                  Boolean(sku && sku !== result.product_id) ||
                  shownVersions.has(result.version_id)
                }
                onClick={() => onReference(result)}
              >
                <LinkOutlined /> {shownVersions.has(result.version_id) ? '已添加' : referenceLabel}
              </button>
            </footer>
          )}
        </div>
      )}
    </div>
  );
}
