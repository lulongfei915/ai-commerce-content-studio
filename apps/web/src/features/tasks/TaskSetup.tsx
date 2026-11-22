import { useState } from 'react';

import { ProductEditor } from '../products/ProductEditor';
import { ProductPicker } from '../products/ProductPicker';
import type { Category, Product } from '../products/api';
import { ApiError } from '../../shared/api/client';
import { Modal } from '../../shared/ui/Modal';
import { addTaskProducts, createTask, purposeLabel, purposes } from './api';
import type { Purpose, Task } from './api';

type Props = {
  initial?: Product;
  task?: Task;
  categories: Category[];
  token: string;
  onClose: () => void;
  onSave: (task: Task) => void;
};

export function TaskSetup({ initial, task, categories, token, onClose, onSave }: Props) {
  const [selected, setSelected] = useState<Product[]>(initial ? [initial] : []);
  const [contents, setContents] = useState<Purpose[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = task ? '添加商品到本次制作' : '新建制作';
  const date = new Intl.DateTimeFormat('sv-SE').format(new Date());
  const suggested =
    selected.length && contents.length
      ? `${selected[0].name}${selected.length > 1 ? `等 ${selected.length} 件` : ''} · ${contents.map((item) => purposeLabel[item]).join('、')} · ${date}`
      : '';

  async function submit() {
    if (busy || !selected.length || (!task && !contents.length)) return;
    setBusy(true);
    setError('');
    try {
      const product_ids = selected.map((product) => product.id);
      const result = task
        ? await addTaskProducts(task, product_ids, token)
        : await createTask(
            { product_ids, contents, name: name?.trim() || suggested || undefined },
            token,
          );
      onSave(result);
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.status === 409
          ? '任务资料已变化，请关闭后刷新任务再试。'
          : '操作未完成，请检查商品和内容后重试。',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Modal title={title} onClose={onClose} busy={busy}>
        <div className="work-form">
          <fieldset className="work-form" disabled={busy}>
            <legend>选择商品 · 已选 {selected.length} 件</legend>
            <ProductPicker
              selected={selected}
              onChange={setSelected}
              excluded={task?.products.map((product) => product.id)}
              revision={revision}
            />
            {categories.length > 0 && (
              <button
                type="button"
                disabled={selected.length >= 50 || (task?.products.length ?? 0) >= 50}
                onClick={() => setAdding(true)}
              >
                添加新商品
              </button>
            )}
          </fieldset>
          {!task && (
            <fieldset className="work-form" disabled={busy || !selected.length}>
              <legend>选择本次内容</legend>
              <div className="work-options">
                {purposes.map((purpose) => (
                  <label key={purpose} className="work-check">
                    <input
                      type="checkbox"
                      checked={contents.includes(purpose)}
                      onChange={() =>
                        setContents((current) =>
                          current.includes(purpose)
                            ? current.filter((item) => item !== purpose)
                            : [...current, purpose],
                        )
                      }
                    />
                    {purposeLabel[purpose]}
                  </label>
                ))}
              </div>
              <label>
                任务名称
                <input
                  maxLength={200}
                  value={name ?? suggested}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            </fieldset>
          )}
          {error && (
            <p role="alert" className="work-error">
              {error}
            </p>
          )}
          <footer className="work-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="work-primary"
              disabled={busy || !selected.length || (!task && !contents.length)}
              onClick={() => {
                void submit();
              }}
            >
              {busy ? '保存中…' : task ? '确认添加' : '进入制作'}
            </button>
          </footer>
        </div>
      </Modal>
      {adding && (
        <ProductEditor
          inSetup
          categories={categories}
          token={token}
          onClose={() => setAdding(false)}
          onSave={(product) => {
            setSelected((current) => [...current, product]);
            setRevision((current) => current + 1);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}
