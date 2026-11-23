import { useEffect, useState } from 'react';
import { apiFetch } from '../../shared/api/client';
import { Modal } from '../../shared/ui/Modal';
import type { Session } from '../auth/session';
import { statusLabel } from '../canvas/status';
import { resultPreview, type TaskResult } from '../creation/results';
import { actionError } from '../creation/api';
import { getTask, type Task } from './api';
import { VersionActions } from './VersionActions';

export function CompanyResults({
  review,
  session,
  current,
}: {
  review: boolean;
  session: Session;
  current?: Task;
}) {
  const [status, setStatus] = useState(review ? 'pending_review' : 'approved');
  const [all, setAll] = useState(!review || !current);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<TaskResult[]>([]);
  const [selected, setSelected] = useState<TaskResult>();
  const [task, setTask] = useState<Task>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ctl = new AbortController(),
      params = new URLSearchParams({ status });
    if (!all && current) params.set('task_id', current.id);
    setError('');
    void apiFetch<TaskResult[]>(`${review ? '/reviews' : '/assets'}?${params}`, {
      signal: ctl.signal,
    })
      .then((rows) => {
        if (!ctl.signal.aborted) setItems(rows);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      });
    return () => ctl.abort();
  }, [review, status, all, current, revision]);
  useEffect(() => {
    if (!selected) return;
    const ctl = new AbortController();
    void getTask(selected.task_id, ctl.signal)
      .then((row) => {
        if (!ctl.signal.aborted) setTask(row);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      });
    return () => ctl.abort();
  }, [selected]);
  const rows = items.filter((a) =>
    `${a.label} ${a.task_id} ${a.product_id} ${a.sku}`.includes(query),
  );
  return (
    <section className="work-form">
      <div className="work-actions">
        <label>
          审核状态
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['pending_review', 'approved', 'rejected', 'revoked'].map((s) => (
              <option key={s} value={s}>
                {statusLabel[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <label>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            全部任务
          </label>
        )}
        <input
          aria-label="搜索资产"
          type="search"
          placeholder="搜索文件、SKU 或来源任务"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      {!rows.length && !error && <p>暂无符合条件的作品</p>}
      <ul className="company-image-list">
        {rows.map((a) => (
          <li key={a.version_id}>
            <button
              onClick={() => {
                setTask(undefined);
                setSelected(a);
              }}
            >
              {a.media === 'image' && a.file_version && (
                <img
                  src={resultPreview(a.task_id, a.version_id, a.file_version, a.version)}
                  alt=""
                  width={80}
                />
              )}
              {a.sku} · {a.label} · V{a.version}
            </button>
          </li>
        ))}
      </ul>
      {selected && (
        <Modal
          title={`${selected.sku} · V${selected.version}`}
          onClose={() => setSelected(undefined)}
        >
          {selected.file_version && selected.media === 'image' && (
            <img
              style={{ maxWidth: '100%' }}
              alt={selected.label}
              src={resultPreview(
                selected.task_id,
                selected.version_id,
                selected.file_version,
                selected.version,
              )}
            />
          )}
          {task && (
            <VersionActions
              id={selected.version_id}
              task={task}
              session={session}
              refresh={() => setRevision((n) => n + 1)}
            />
          )}
        </Modal>
      )}
    </section>
  );
}
