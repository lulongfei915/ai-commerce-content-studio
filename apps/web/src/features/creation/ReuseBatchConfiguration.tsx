import { useEffect, useState } from 'react';

import type { Task } from '../tasks/api';
import { actionError, draftWrite, listDrafts, type Draft } from './api';

export function ReuseConfiguration({
  task,
  draft,
  token,
  busy,
  onBusy,
  onSaved,
}: {
  task: Task;
  draft: Draft;
  token: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (draft: Draft) => void;
}) {
  const [sources, setSources] = useState<Draft[]>();
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const source = sources?.find((item) => item.id === id);
  useEffect(() => {
    const request = new AbortController();
    void Promise.all([
      listDrafts(task.id, request.signal),
      listDrafts(task.id, request.signal, 'canvas'),
    ])
      .then((lists) => {
        if (!request.signal.aborted)
          setSources(lists.flat().filter((item) => item.purpose === draft.purpose));
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setError(actionError(cause));
      });
    return () => request.abort();
  }, [draft.purpose, task.id]);

  async function apply() {
    if (!source || busy) return;
    onBusy(true);
    setError('');
    try {
      onSaved(await draftWrite(draft, token, '/reuse', {
        source_id: source.id,
        source_version: source.version,
      }));
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      onBusy(false);
    }
  }

  return (
    <div className="work-form">
      {error && <p role="alert" className="work-error">{error}</p>}
      {sources?.length ? (
        <>
          <label>
            来源草稿
            <select value={id} disabled={busy} onChange={(event) => setId(event.target.value)}>
              <option value="">请选择</option>
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.entry === 'canvas' ? '画布' : '快捷生成'} ·{' '}
                  {task.products.find((product) => product.id === item.product_id)?.sku} ·{' '}
                  {item.prompt.trim().slice(0, 35) || '空提示词'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="work-primary"
            disabled={busy || !source}
            onClick={() => void apply()}
          >
            覆盖此项配置
          </button>
        </>
      ) : sources ? (
        <p className="work-muted">暂无同用途的来源草稿</p>
      ) : (
        !error && <p role="status">正在读取草稿…</p>
      )}
    </div>
  );
}
