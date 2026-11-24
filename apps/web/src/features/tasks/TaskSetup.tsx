import { useId, useState } from 'react';
import {
  ArrowRightOutlined,
  PictureOutlined,
  PlusOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';

import { ProductEditor } from '../products/ProductEditor';
import { ProductPicker } from '../products/ProductPicker';
import type { Category, Product } from '../products/api';
import { ApiError } from '../../shared/api/client';
import { Modal } from '../../shared/ui/Modal';
import { addTaskProducts, createTask, purposeLabel, purposes } from './api';
import type { Purpose, Task } from './api';
import './task-setup.css';

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
  const [contents, setContents] = useState<Purpose[]>(task ? [] : ['main']);
  const [name, setName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const productHeading = useId();
  const contentsHeading = useId();
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
        <div className="task-setup">
          <div className="task-setup-body">
            {!task && <p className="task-setup-intro">选好商品和制作内容，即可进入编辑。</p>}
            <fieldset
              className="task-setup-section"
              aria-labelledby={productHeading}
              disabled={busy}
            >
              <div className="task-setup-heading">
                <h3 id={productHeading}>{task ? '选择要加入的商品' : '1. 选择商品'}</h3>
                {categories.length > 0 && (
                  <button
                    type="button"
                    disabled={selected.length >= 50 || (task?.products.length ?? 0) >= 50}
                    onClick={() => setAdding(true)}
                  >
                    <PlusOutlined aria-hidden="true" /> 添加新商品
                  </button>
                )}
              </div>
              <ProductPicker
                categories={categories}
                initialId={initial?.id}
                selected={selected}
                onChange={setSelected}
                excluded={task?.products.map((product) => product.id)}
                revision={revision}
              />
              <p className="task-setup-selection" role="status">
                {selected.length
                  ? `已选 ${selected.length} 件：${selected.map((product) => product.name).join('、')}`
                  : '尚未选择商品'}
              </p>
            </fieldset>
            {!task && (
              <fieldset
                className="task-setup-section"
                aria-labelledby={contentsHeading}
                disabled={busy}
              >
                <h3 id={contentsHeading}>
                  2. 选择制作内容 <small>可多选</small>
                </h3>
                <div className="task-setup-purposes">
                  {purposes.map((purpose) => (
                    <label key={purpose}>
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
                      <span>
                        {purpose === 'video' ? (
                          <VideoCameraOutlined aria-hidden="true" />
                        ) : (
                          <PictureOutlined aria-hidden="true" />
                        )}
                        {purpose === 'main' ? '商品主图' : purposeLabel[purpose]}
                      </span>
                    </label>
                  ))}
                </div>
                <details className="task-setup-name">
                  <summary>
                    <span>制作名称</span>{' '}
                    <span className="work-muted">
                      {name?.trim() || suggested || '选择商品后自动命名'}
                    </span>
                  </summary>
                  <input
                    aria-label="任务名称"
                    maxLength={200}
                    value={name ?? suggested}
                    onChange={(event) => setName(event.target.value)}
                  />
                </details>
              </fieldset>
            )}
            {error && (
              <p role="alert" className="work-error">{error}</p>
            )}
          </div>
          <footer className="task-setup-footer">
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
              <ArrowRightOutlined aria-hidden="true" />
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
