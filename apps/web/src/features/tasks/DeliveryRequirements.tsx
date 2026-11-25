import { useState } from 'react';
import { PlusOutlined } from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import { apiWrite } from '../../shared/api/client';
import { actionError } from '../creation/api';
import { purposeLabel, purposes, type Purpose, type Task } from './api';
import type { components } from '../../shared/api/generated';
import '../templates/company.css';
import './delivery-requirements.css';

type Row = components['schemas']['Requirement'] & { key: string };
const name = (p: Purpose) => (p === 'main' ? '商品主图' : purposeLabel[p]);
const imageSizes: Record<string, string[]> = {
  '1:1': ['1K', '1.5K', '2K'],
  '3:4': ['1.5K', '2K'],
  '4:3': ['2K'],
  '9:16': ['2K'],
  '16:9': ['2K'],
};
const squareLabels: Record<string, string> = {
  '1K': '1024 × 1024',
  '1.5K': '1536 × 1536',
  '2K': '2048 × 2048',
};
function defaults(purpose: Purpose) {
  const video = purpose === 'video';
  return {
    purpose,
    module: name(purpose),
    ratio: video ? '9:16' : '1:1',
    resolution: video ? '1080p' : '2K',
    duration: video ? 12 : null,
  };
}
function fromTask(task: Task) {
  const rows: Row[] = [];
  for (const p of task.positions) {
    const module = p.module || name(p.purpose);
    const row = rows.find(
      (r) => r.product_id === p.product_id && r.purpose === p.purpose && r.module === module,
    );
    if (row) row.count++;
    else
      rows.push({
        key: p.id,
        product_id: p.product_id,
        purpose: p.purpose,
        module,
        count: 1,
        ratio: p.ratio,
        resolution: p.resolution,
        duration: p.duration,
      });
  }
  return rows;
}

export function DeliveryRequirements({
  task,
  token,
  onSave,
  onClose,
}: {
  task: Task;
  token: string;
  onSave: (t: Task) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState(() => fromTask(task));
  const [removed, setRemoved] = useState<number>();
  const confirm = removed !== undefined;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function update(key: string, data: Partial<Row>) {
    setRows(rows.map((r) => (r.key === key ? { ...r, ...data } : r)));
  }
  function add(purpose: Purpose) {
    const product_id = task.products[0].id;
    const fields = defaults(purpose);
    const names = rows
      .filter((r) => r.product_id === product_id && r.purpose === purpose)
      .map((r) => r.module.trim());
    let module = fields.module;
    for (let n = 2; names.includes(module); n++) module = `${fields.module}${n}`;
    setRows([...rows, { ...fields, key: crypto.randomUUID(), product_id, module, count: 1 }]);
  }
  async function submit() {
    if (busy) return;
    const body = {
      expected_version: task.version,
      rows: rows.map(({ product_id, purpose, module, count, ratio, resolution, duration }) => ({
        product_id,
        purpose,
        module: module.trim(),
        count,
        ratio,
        resolution,
        duration,
      })),
    };
    const keys = body.rows.map((r) => JSON.stringify([r.product_id, r.purpose, r.module]));
    if (!rows.length) return setError('至少保留一项交付要求。');
    if (body.rows.some((r) => !r.module)) return setError('模块名称须为 1–40 字。');
    if (new Set(keys).size !== rows.length) return setError('同一商品和用途的模块名称不能重复。');
    if (rows.reduce((n, r) => n + r.count, 0) > 100)
      return setError('单任务最多配置 100 个交付位置。');
    setBusy(true);
    setError('');
    try {
      const path = `/tasks/${task.id}/requirements`;
      if (confirm) onSave(await apiWrite<Task>(path, token, body, 'PUT'));
      else
        setRemoved((await apiWrite<{ removed: number }>(`${path}/preview`, token, body)).removed);
    } catch (e) {
      setError(actionError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={confirm ? '确认交付要求' : '配置交付要求'}
      busy={busy}
      onClose={onClose}
      className={`company-editor-dialog requirements-dialog${confirm ? ' requirements-confirm' : ''}`}
    >
      <form
        className="work-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div key={confirm ? 'review' : 'edit'} className="company-editor-body requirements-body">
          {confirm ? (
            <>
              <p>
                本次共 {rows.length} 项要求、{rows.reduce((n, r) => n + r.count, 0)} 个交付位置。
              </p>
              <p>
                {removed
                  ? `${removed} 个采用位置因规格、模块或数量变化将被清除。`
                  : '仍匹配的采用版本全部保留。'}
                已生成文件、历史版本与审核决定保留。
              </p>
            </>
          ) : (
            <>
              <p>按商品定义模块、数量与规格。每一张图片或视频单独采用，保留仍匹配的采用版本。</p>
              {rows.map((row, i) => (
                <fieldset
                  key={row.key}
                  disabled={busy}
                  className="requirement-row"
                  aria-labelledby={`req-${row.key}`}
                >
                  <div className="requirement-heading">
                    <strong id={`req-${row.key}`}>要求 {String(i + 1).padStart(2, '0')}</strong>
                    <button
                      type="button"
                      onClick={() => setRows(rows.filter((r) => r.key !== row.key))}
                    >
                      移除
                    </button>
                  </div>
                  <div className="requirement-fields">
                    <label>
                      商品
                      <select
                        value={row.product_id}
                        onChange={(e) => update(row.key, { product_id: e.target.value })}
                      >
                        {task.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {task.products.some(
                              (other) => other.id !== p.id && other.name === p.name,
                            )
                              ? `${p.name} · ${p.sku}`
                              : p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      用途
                      <select
                        value={row.purpose}
                        onChange={(e) => {
                          const purpose = e.target.value as Purpose;
                          update(row.key, defaults(purpose));
                        }}
                      >
                        {purposes.map((p) => (
                          <option key={p} value={p}>
                            {name(p)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      模块名称
                      <input
                        required
                        maxLength={40}
                        value={row.module}
                        onChange={(e) => update(row.key, { module: e.target.value })}
                      />
                    </label>
                    <label>
                      数量
                      <input
                        type="number"
                        required
                        min={1}
                        max={6}
                        value={row.count || ''}
                        onChange={(e) => update(row.key, { count: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      画面比例
                      <select
                        value={row.ratio ?? ''}
                        onChange={(e) => {
                          const ratio = e.target.value;
                          const options =
                            row.purpose === 'video' ? ['720p', '1080p'] : (imageSizes[ratio] ?? []);
                          update(row.key, {
                            ratio: ratio || null,
                            resolution: ratio
                              ? options.includes(row.resolution ?? '')
                                ? row.resolution
                                : options[options.length - 1]
                              : null,
                            duration: ratio && row.purpose === 'video' ? row.duration || 12 : null,
                          });
                        }}
                      >
                        <option value="">规格未指定</option>
                        {(row.purpose === 'video'
                          ? ['1:1', '16:9', '9:16']
                          : Object.keys(imageSizes)
                        ).map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      清晰度
                      <select
                        disabled={!row.ratio}
                        value={row.resolution ?? ''}
                        onChange={(e) => update(row.key, { resolution: e.target.value })}
                      >
                        {!row.ratio && <option value="">规格未指定</option>}
                        {(row.purpose === 'video'
                          ? ['720p', '1080p']
                          : (imageSizes[row.ratio ?? ''] ?? [])
                        ).map((s) => (
                          <option key={s} value={s}>
                            {row.ratio === '1:1' ? (squareLabels[s] ?? s) : s}
                          </option>
                        ))}
                      </select>
                    </label>
                    {row.purpose === 'video' && (
                      <label>
                        视频总时长
                        <select
                          disabled={!row.ratio}
                          value={row.duration ?? ''}
                          onChange={(e) => update(row.key, { duration: Number(e.target.value) })}
                        >
                          {!row.ratio && <option value="">规格未指定</option>}
                          {[5, 6, 10, 12, 15].map((d) => (
                            <option key={d} value={d}>
                              {d} 秒
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                </fieldset>
              ))}
              <div className="requirement-add">
                {purposes.map((p) => (
                  <button type="button" key={p} disabled={busy} onClick={() => add(p)}>
                    <PlusOutlined aria-hidden="true" /> {{ main: '主图', detail: '详情模块', video: '视频' }[p]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {error && (
          <p className="requirements-error" role="alert">
            {error}
          </p>
        )}
        <div className="work-actions company-editor-footer">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!confirm) return onClose();
              setRemoved(undefined);
              setError('');
            }}
          >
            {confirm ? '返回修改' : '取消'}
          </button>
          <button type="submit" className="work-primary" disabled={busy}>
            {confirm ? '确认保存' : '核对并保存'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
