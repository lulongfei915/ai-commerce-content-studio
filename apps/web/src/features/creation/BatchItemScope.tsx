import { useState } from 'react';
import { DeleteOutlined, RetweetOutlined, UndoOutlined } from '@ant-design/icons';
import { apiWrite } from '../../shared/api/client';
import { purposeLabel, type Task } from '../tasks/api';
import { actionError, draftWrite, type Draft } from './api';

const fields = { prompt: '提示词', count: '数量', size: '比例与清晰度' } as const;
type RestoreField = keyof typeof fields;

export function BatchItemScope({ draft, task, token, path, busy, onBusy, onSaved, onRemoved }: {
  draft: Draft;
  task: Task;
  token: string;
  path: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (draft: Draft) => void;
  onRemoved: () => void;
}) {
  const [position, setPosition] = useState('');
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<{ prompt: string; version: number }>();
  const overrides = draft.batch_overrides ?? ['prompt', 'count', 'ratio', 'resolution'];
  const restored = (Object.keys(fields) as RestoreField[]).filter((field) =>
    field === 'size'
      ? overrides.includes('ratio') || overrides.includes('resolution')
      : overrides.includes(field),
  );
  const url = `${path}/items/${draft.id}`;
  const positions = task.positions.filter(
    (item) => (item.purpose === 'video') === (draft.purpose === 'video'),
  );
  async function change(action: 'scope' | 'restore' | 'remove' | 'undo', field?: RestoreField) {
    if (busy) return;
    if (action === 'restore' && !field && !window.confirm('将此项恢复为公共配置并清除独立参考？')) return;
    if (action === 'remove' && !window.confirm('删除此未提交项？')) return;
    setError('');
    onBusy(true);
    try {
      const expected_version = draft.version;
      if (action === 'remove') {
        await apiWrite(`${url}?expected_version=${expected_version}`, token, undefined, 'DELETE');
        onRemoved();
      } else if (action === 'undo') {
        if (undo?.version !== draft.version) return;
        onSaved(await draftWrite(draft, token, '', { prompt: undo.prompt }, 'PATCH'));
        setUndo(undefined);
      } else {
        const next = action === 'restore'
          ? await apiWrite<Draft>(`${url}/restore`, token, { expected_version, field })
          : await apiWrite<Draft>(url, token, { expected_version, position_id: position }, 'PATCH');
        setUndo(field === 'prompt' && draft.prompt !== next.prompt
          ? { prompt: draft.prompt, version: next.version } : undefined);
        onSaved(next);
        setPosition('');
      }
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      onBusy(false);
    }
  }

  return (
    <details className="batch-scope">
      <summary>商品与用途</summary>
      <div className="work-form">
        <label>
          目标交付位置
          <select value={position} disabled={busy} onChange={(e) => setPosition(e.target.value)}>
            <option value="">请选择</option>
            {positions.map((item) => (
              <option key={item.id} value={item.id}>
                {task.products.find((product) => product.id === item.product_id)?.sku} ·{' '}
                {item.module || purposeLabel[item.purpose]}
              </option>
            ))}
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="work-actions">
          <button disabled={busy || !position} onClick={() => void change('scope')}>
            <RetweetOutlined /> 更换并核对
          </button>
          <button disabled={busy} onClick={() => void change('restore')}>
            <UndoOutlined /> 恢复公共配置
          </button>
          <button disabled={busy} onClick={() => void change('remove')}>
            <DeleteOutlined /> 删除此项
          </button>
        </div>
        <div className="work-actions">
          {restored.map((field) => (
            <button key={field} disabled={busy} onClick={() => void change('restore', field)}>
              <UndoOutlined /> 恢复{fields[field]}
            </button>
          ))}
          {undo?.version === draft.version && (
            <button disabled={busy} onClick={() => void change('undo')}>撤销恢复提示词</button>
          )}
        </div>
      </div>
    </details>
  );
}
