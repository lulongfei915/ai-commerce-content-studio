import { useCallback, useEffect, useState } from 'react';

import type { Category } from '../products/api';
import type { Task } from '../tasks/api';
import { CreationEditor } from './CreationEditor';
import { actionError, createDraft, listDrafts } from './api';
import type { Draft } from './api';

export function QuickCreation({
  task,
  categories,
  token,
  onDirty,
}: {
  task: Task;
  categories: Category[];
  token: string;
  onDirty: (dirty: boolean) => void;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [dirty, setDirty] = useState(false);
  const reportDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  const [selected, setSelected] = useState('');
  const [position, setPosition] = useState(
    task.positions.find((item) => item.purpose !== 'video')?.id ?? '',
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const request = new AbortController();
    void listDrafts(task.id, request.signal)
      .then((items) => {
        if (!request.signal.aborted) {
          setDrafts(items);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) {
          setError(actionError(cause));
          setLoading(false);
        }
      });
    return () => request.abort();
  }, [task.id, retry]);
  const options = task.positions.filter((item) => item.purpose !== 'video');
  const target = options.find((item) => item.id === position);
  const picked =
    target &&
    drafts.find((item) => item.product_id === target.product_id && item.purpose === target.purpose);
  const active = drafts.find((item) => item.id === selected);
  const product = active && task.products.find((item) => item.id === active.product_id);
  if (!options.length) return null;
  return (
    <section className="work-form" aria-label="图片创作">
      <div className="work-row">
        <label>
          创作商品与用途{' '}
          <select
            value={position}
            disabled={busy}
            onChange={(event) => setPosition(event.target.value)}
          >
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {task.products.find((product) => product.id === item.product_id)?.sku} ·{' '}
                {item.purpose === 'main' ? '主图' : '详情素材'}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={loading || busy || !target || Boolean(error)}
          onClick={() => {
            if (
              dirty &&
              picked?.id !== selected &&
              !window.confirm('当前草稿有未保存的编辑，确定切换？')
            )
              return;
            if (picked) {
              setSelected(picked.id);
              return;
            }
            if (!target || target.purpose === 'video') return;
            setBusy(true);
            setError('');
            onDirty(true);
            void createDraft(task.id, target.product_id, target.purpose, token)
              .then((draft) => {
                setDrafts((current) => [...current.filter((item) => item.id !== draft.id), draft]);
                setSelected(draft.id);
              })
              .catch((cause: unknown) => setError(actionError(cause)))
              .finally(() => {
                setBusy(false);
                onDirty(false);
              });
          }}
        >
          {picked ? '打开创作草稿' : '新建创作草稿'}
        </button>
      </div>
      {error && (
        <p role="alert" className="work-error">
          {error}{' '}
          <button
            type="button"
            onClick={() => {
              setError('');
              setLoading(true);
              setRetry((value) => value + 1);
            }}
          >
            重试
          </button>
        </p>
      )}
      {active && product && (
        <CreationEditor
          key={active.id}
          draft={active}
          product={product}
          categories={categories}
          token={token}
          onDirty={reportDirty}
          onSaved={(draft) =>
            setDrafts((current) => current.map((item) => (item.id === draft.id ? draft : item)))
          }
        />
      )}
    </section>
  );
}
