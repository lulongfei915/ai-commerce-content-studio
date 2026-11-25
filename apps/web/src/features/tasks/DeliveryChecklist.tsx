import { useState } from 'react';
import { ArrowRightOutlined } from '@ant-design/icons';
import { apiWrite } from '../../shared/api/client';
import { Modal } from '../../shared/ui/Modal';
import { actionError } from '../creation/api';
import { resultPreview, type TaskResult } from '../creation/results';
import { purposeLabel, purposes, type Task } from './api';
import './delivery-checklist.css';

type Position = Task['positions'][number];
export type Adoption = { version_id: string; download: string };

export function DeliveryChecklist({
  task,
  items,
  adoptions,
  canAdopt,
  canDownload,
  token,
  onOpen,
  onCreate,
  onRefresh,
}: {
  task?: Task;
  items: TaskResult[];
  adoptions: Record<string, Adoption | null>;
  canAdopt: boolean;
  canDownload: boolean;
  token: string;
  onOpen: (item: TaskResult, positionId: string) => void;
  onCreate?: (position: string) => void;
  onRefresh: () => void;
}) {
  const [missing, setMissing] = useState(false);
  const [picker, setPicker] = useState<{ position: Position; choices: TaskResult[] }>();
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const positions = task?.positions ?? [];
  const adopted = (position: Position) =>
    items.find(
      (item) =>
        item.version_id === adoptions[position.id]?.version_id &&
        item.status === 'approved' &&
        item.previewable,
    );
  const filled = positions.filter(adopted).length;
  const gaps = positions.length - filled;

  function choose(position: Position, choices: TaskResult[], selected?: TaskResult) {
    setChoice(selected?.version_id ?? choices[0]?.version_id ?? '');
    setPicker({ position, choices });
    setError('');
  }

  return (
    <>
      <div className="delivery-summary">
        <p role="status">
          {task?.products.length ?? 0} 个 SKU <span>·</span> 已配齐{' '}
          <strong>
            {filled}/{positions.length}
          </strong>{' '}
          <span>·</span> 待补齐 {gaps}
        </p>
        <label>
          <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
          只看待补齐{missing ? `（${gaps}）` : ''}
        </label>
      </div>
      {!positions.length && (
        <p className="resource-empty">{task ? '当前任务没有交付位置' : '请选择任务查看交付清单'}</p>
      )}
      {missing && !!positions.length && !gaps && (
        <div className="delivery-empty">
          <p>当前任务已全部配齐</p>
          <button onClick={() => setMissing(false)}>查看全部位置</button>
        </div>
      )}
      {task?.products.map((product) => {
        const own = positions
          .filter((p) => p.product_id === product.id)
          .sort((a, b) => purposes.indexOf(a.purpose) - purposes.indexOf(b.purpose));
        const visible = own.filter((p) => !missing || !adopted(p));
        if (!visible.length) return null;
        return (
          <section className="delivery-product" key={product.id} aria-label={product.sku}>
            <header>
              <div>
                <h3>{product.name}</h3>
                <span>{product.sku}</span>
              </div>
              <span>
                {own.filter(adopted).length}/{own.length} 已配齐
              </span>
            </header>
            <div className="delivery-position-grid">
              {visible.map((p) => {
                const selected = adopted(p);
                const matching = items.filter(
                  (i) =>
                    i.product_id === p.product_id &&
                    i.purpose === p.purpose &&
                    (!i.matching_positions || i.matching_positions.includes(p.id)),
                );
                const available = matching.filter(
                  (i) =>
                    i.status === 'approved' &&
                    i.previewable &&
                    (i.task_id === task.id || i.version_id === selected?.version_id) &&
                    !positions.some(
                      (other) =>
                        other.id !== p.id && adoptions[other.id]?.version_id === i.version_id,
                    ),
                );
                const pending = matching.find((i) => i.status === 'pending_review');
                const rejected = matching.find((i) => i.status === 'rejected');
                const revoked = matching.find(
                  (i) => i.version_id === adoptions[p.id]?.version_id && i.status === 'revoked',
                );
                const issue = pending ?? rejected ?? revoked;
                const badge = selected
                  ? '可交付'
                  : available.length
                    ? '待选版本'
                    : pending
                      ? '待审核'
                      : rejected
                        ? '已驳回'
                        : revoked
                          ? '已撤回'
                          : '未制作';
                const note = available.length
                  ? `${available.length} 个匹配的已批准版本`
                  : pending
                    ? '已有匹配素材，正在等待审核'
                    : rejected
                      ? '查看驳回原因后，调整并返工'
                      : revoked
                        ? '原采用版本已撤回，请补齐素材'
                        : '暂无符合此用途的素材';
                return (
                  <article className="delivery-position" key={p.id}>
                    <div className="delivery-position-title">
                      <h4>
                        {p.module || (p.purpose === 'main' ? '商品主图' : purposeLabel[p.purpose])}
                      </h4>
                      <span
                        className="delivery-badge"
                        data-state={
                          selected
                            ? 'ready'
                            : pending || available.length
                              ? 'waiting'
                              : issue
                                ? 'issue'
                                : available.length
                                  ? 'waiting'
                                  : 'empty'
                        }
                      >
                        {badge}
                      </span>
                    </div>
                    <small className="delivery-spec">
                      {p.ratio
                        ? [p.ratio, p.resolution, p.duration && `${p.duration}s`]
                            .filter(Boolean)
                            .join(' · ')
                        : '规格未指定'}
                    </small>
                    {selected ? (
                      <>
                        <div className="delivery-picked">
                          {selected.media === 'image' && selected.file_version && (
                            <img
                              alt=""
                              src={resultPreview(
                                selected.task_id,
                                selected.version_id,
                                selected.file_version,
                                selected.version,
                              )}
                            />
                          )}
                          <div>
                            <strong>{selected.label}</strong>
                            <small>V{selected.version}</small>
                          </div>
                        </div>
                        <div className="delivery-position-actions">
                          <button onClick={() => onOpen(selected, p.id)}>查看版本</button>
                          {canAdopt && available.length > 1 && (
                            <button onClick={() => choose(p, available, selected)}>更换版本</button>
                          )}
                          {canDownload && adoptions[p.id]?.download && (
                            <a href={adoptions[p.id]?.download} download>
                              下载交付版本
                            </a>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <p>{note}</p>
                        <div className="delivery-position-actions">
                          {available.length ? (
                            <button disabled={!canAdopt} onClick={() => choose(p, available)}>
                              选择交付版本 <ArrowRightOutlined aria-hidden="true" />
                            </button>
                          ) : issue ? (
                            <button onClick={() => onOpen(issue, p.id)}>
                              {pending ? '前往审核' : '查看问题'}{' '}
                              <ArrowRightOutlined aria-hidden="true" />
                            </button>
                          ) : (
                            onCreate && (
                              <button onClick={() => onCreate(p.id)}>
                                制作此位置 <ArrowRightOutlined aria-hidden="true" />
                              </button>
                            )
                          )}
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        );
      })}
      {picker && (
        <Modal title="选择交付版本" busy={busy} onClose={() => setPicker(undefined)}>
          <form
            className="work-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || !choice) return;
              setBusy(true);
              setError('');
              void apiWrite(
                `/delivery-positions/${picker.position.id}/adoption`,
                token,
                { version_id: choice },
                'PUT',
              )
                .then(() => {
                  setPicker(undefined);
                  onRefresh();
                })
                .catch((cause) => setError(actionError(cause)))
                .finally(() => setBusy(false));
            }}
          >
            <fieldset className="work-form" disabled={busy}>
              <legend>{purposeLabel[picker.position.purpose]}</legend>
              {picker.choices.map((item) => (
                <label className="work-check" key={item.version_id}>
                  <input
                    type="radio"
                    name="version"
                    checked={item.version_id === choice}
                    onChange={() => setChoice(item.version_id)}
                  />
                  {item.label} · V{item.version}
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="work-error">
                {error}
              </p>
            )}
            <div className="work-actions">
              <button type="submit" className="work-primary" disabled={busy || !choice}>
                确认选择
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
