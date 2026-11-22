import { useState } from 'react';

import type { Category } from '../products/api';
import { photoPreviewUrl } from '../products/preview';
import { Modal } from '../../shared/ui/Modal';
import { purposeLabel, updateTask } from './api';
import type { Task } from './api';

type Props = {
  task: Task;
  categories: Category[];
  canCreate: boolean;
  token: string;
  onAdd: () => void;
  onChange: (task: Task) => void;
};

export function TaskDetail({ task, categories, canCreate, token, onAdd, onChange }: Props) {
  const [rename, setRename] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  return (
    <section className="work-form" aria-label="当前任务">
      {canCreate && (
        <div className="work-actions">
          <button
            type="button"
            onClick={() => {
              setError('');
              setRename(true);
            }}
          >
            修改名称
          </button>
          <button type="button" onClick={onAdd} disabled={task.products.length >= 50}>
            添加商品到本次制作
          </button>
        </div>
      )}
      <p className="work-muted">
        草稿 · {task.products.length} 件商品 · {task.positions.length} 个交付位置
      </p>
      <div className="work-cards">
        {task.products.map((product) => {
          const positions = task.positions.filter((position) => position.product_id === product.id);
          const category = categories.find((item) => item.id === product.category);
          return (
            <article className="work-card" key={product.id}>
              <h3>{product.name}</h3>
              <p className="work-muted">
                {product.sku} · {category?.label ?? product.category}
              </p>
              <div className="photo-list">
                {product.photos.map((photo, index) => (
                  <img
                    key={photo.file_id}
                    loading="lazy"
                    alt={`${product.name}实拍 ${index + 1}`}
                    src={photoPreviewUrl(product.id, photo.file_id)}
                  />
                ))}
              </div>
              <ul className="position-list">
                {positions.map((position) => {
                  const missing = product.readiness[position.purpose] ?? [];
                  return (
                    <li key={position.id}>
                      <strong>{purposeLabel[position.purpose]}</strong>
                      <span>待补齐素材</span>
                      {missing.length ? (
                        <small>
                          生成前需补齐：
                          {missing
                            .map((key) =>
                              key === 'photo_required'
                                ? '商品实拍'
                                : (category?.fields.find((field) => field.key === key)?.label ??
                                  key),
                            )
                            .join('、')}
                        </small>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
      {rename && (
        <Modal title="修改任务名称" onClose={() => setRename(false)} busy={saving}>
          <form
            className="work-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(new FormData(event.currentTarget).get('name') ?? '').trim();
              if (!name || saving) return;
              setSaving(true);
              setError('');
              void updateTask(task, name, token)
                .then((updated) => {
                  onChange(updated);
                  setRename(false);
                })
                .catch(() => setError('名称未保存。请刷新任务后重试。'))
                .finally(() => setSaving(false));
            }}
          >
            <label>
              任务名称
              <input
                name="name"
                required
                defaultValue={task.name}
                maxLength={200}
                disabled={saving}
              />
            </label>
            {error && (
              <p role="alert" className="work-error">
                {error}
              </p>
            )}
            <footer className="work-actions">
              <button type="submit" className="work-primary" disabled={saving}>
                保存名称
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}
