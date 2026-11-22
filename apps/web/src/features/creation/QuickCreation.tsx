import { useState } from 'react';

import type { Category } from '../products/api';
import { purposeLabel } from '../tasks/api';
import type { Task } from '../tasks/api';
import { CreationEditor } from './CreationEditor';
import type { DraftEdits } from './CreationEditor';
import type { Draft } from './api';

export function QuickCreation({
  task,
  categories,
  token,
  drafts,
  selected,
  edits,
  busy,
  loading,
  onSelect,
  onCreate,
  onSaved,
  onEdit,
  onBusy,
}: {
  task: Task;
  categories: Category[];
  token: string;
  drafts: Draft[];
  selected?: Draft;
  edits?: DraftEdits;
  busy: boolean;
  loading: boolean;
  onSelect: (id: string) => void;
  onCreate: (
    product: string,
    purpose: Draft['purpose'],
    primary: boolean,
  ) => Promise<Draft | undefined>;
  onSaved: (draft: Draft) => void;
  onEdit: (id: string, edits: DraftEdits | undefined) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [position, setPosition] = useState(task.positions[0]?.id ?? '');
  const target = task.positions.find((item) => item.id === position);
  const product = task.products.find((item) => item.id === selected?.product_id);
  return (
    <section className="work-form" aria-label="快捷创作">
      <div className="work-row">
        <label>
          创作商品与用途{' '}
          <select
            value={position}
            disabled={busy}
            onChange={(event) => setPosition(event.target.value)}
          >
            {task.positions.map((item) => (
              <option key={item.id} value={item.id}>
                {task.products.find((entry) => entry.id === item.product_id)?.sku} ·{' '}
                {purposeLabel[item.purpose]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy || loading || !target}
          onClick={() => {
            if (!target) return;
            const existing = drafts.find(
              (draft) =>
                draft.slot === 'primary' &&
                draft.product_id === target.product_id &&
                draft.purpose === target.purpose,
            );
            if (existing) onSelect(existing.id);
            else void onCreate(target.product_id, target.purpose, true);
          }}
        >
          {target &&
          drafts.some(
            (draft) =>
              draft.slot === 'primary' &&
              draft.product_id === target.product_id &&
              draft.purpose === target.purpose,
          )
            ? '打开创作草稿'
            : '新建创作草稿'}
        </button>
      </div>
      {drafts.length > 0 && (
        <label>
          当前草稿{' '}
          <select
            value={selected?.id ?? ''}
            disabled={busy}
            onChange={(event) => onSelect(event.target.value)}
          >
            <option value="">选择草稿</option>
            {drafts.map((draft, index) => (
              <option key={draft.id} value={draft.id}>
                {task.products.find((item) => item.id === draft.product_id)?.sku} ·{' '}
                {purposeLabel[draft.purpose]} · {index + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && product && (
        <CreationEditor
          key={selected.id}
          draft={selected}
          product={product}
          categories={categories}
          token={token}
          edits={edits}
          onEdit={(next) => onEdit(selected.id, next)}
          onBusy={onBusy}
          onSaved={onSaved}
        />
      )}
    </section>
  );
}
