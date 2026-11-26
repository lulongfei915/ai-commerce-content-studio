import { useEffect, useState } from 'react';
import { DeleteOutlined, PlusOutlined, ProfileOutlined } from '@ant-design/icons';

import { Modal } from '../../shared/ui/Modal';
import type { Product } from '../products/api';
import { getTask, type Task } from '../tasks/api';
import { actionError, draftWrite, type Draft, type VideoParameters } from './api';
import type { components } from '../../shared/api/generated';

type Shot = components['schemas']['Shot'];

export function StoryboardControl({
  draft, product, video, token, busy, dirty, prepare, onSaved,
}: {
  draft: Draft;
  product: Product;
  video: VideoParameters;
  token: string;
  busy: boolean;
  dirty: boolean;
  prepare: () => Promise<Draft>;
  onSaved: (draft: Draft) => void;
}) {
  const [open, setOpen] = useState(false);
  const confirmed = !dirty && draft.storyboard?.confirmed_version === draft.version &&
    draft.storyboard.product_fact_version === product.fact_version;
  return (
    <>
      <button type="button" disabled={busy} onClick={() => setOpen(true)}>
        <ProfileOutlined aria-hidden="true" /> {confirmed ? '已确认分镜' : '成片分镜'}
      </button>
      {open && (
        <StoryboardDialog draft={draft} product={product} video={video} token={token}
          prepare={prepare} onSaved={onSaved} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function StoryboardDialog({
  draft, product, video, token, prepare, onSaved, onClose,
}: {
  draft: Draft;
  product: Product;
  video: VideoParameters;
  token: string;
  prepare: () => Promise<Draft>;
  onSaved: (draft: Draft) => void;
  onClose: () => void;
}) {
  const duration = video.duration ?? 5;
  const [positions, setPositions] = useState<Task['positions']>();
  const [position, setPosition] = useState(draft.batch_position_id ?? draft.storyboard?.position_id ?? '');
  const [shots, setShots] = useState<Shot[]>(
    draft.storyboard?.shots ?? [{ duration, visual: '', narration: '', fact_keys: [] }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void getTask(draft.task_id, controller.signal).then((task) => {
      const matches = task.positions.filter((item) =>
        item.purpose === 'video' && item.product_id === product.id &&
        (!draft.batch_position_id || item.id === draft.batch_position_id),
      );
      setPositions(matches);
      setPosition((current) => matches.some((item) => item.id === current) ? current : matches[0]?.id ?? '');
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(actionError(cause));
    });
    return () => controller.abort();
  }, [draft.task_id, draft.batch_position_id, product.id]);

  function edit(index: number, update: Partial<Shot>) {
    setShots((current) => current.map((shot, i) => i === index ? { ...shot, ...update } : shot));
  }

  async function save(clear = false) {
    setBusy(true);
    setError('');
    try {
      const saved = await prepare();
      const updated = await draftWrite(saved, token, clear ? '/storyboard/clear' : '/storyboard',
        clear ? {} : { position_id: position, shots });
      onSaved(updated);
      onClose();
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  const total = shots.reduce((sum, shot) => sum + shot.duration, 0);
  const valid = total === duration && shots.every((shot) => shot.duration > 0 && shot.visual.trim());
  let elapsed = 0;
  return (
    <Modal title={`${product.sku} · 成片分镜`} onClose={onClose} busy={busy}>
      <form className="work-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label>
          交付位置
          <select value={position} disabled={busy || !positions?.length}
            onChange={(event) => setPosition(event.target.value)}>
            {!positions?.length && <option value="">{positions ? '没有视频交付位置' : '读取交付位置…'}</option>}
            {positions?.map((item, index) => (
              <option key={item.id} value={item.id}>
                {[item.module ?? '带货视频', `第 ${index + 1} 个位置`, item.ratio,
                  item.resolution, item.duration && `${item.duration} 秒`].filter(Boolean).join(' · ')}
              </option>
            ))}
          </select>
        </label>
        {draft.references.length > 0 && <p>参考素材 · {draft.references.map((ref) => ref.label).join('、')}</p>}
        {shots.map((shot, index) => {
          const start = elapsed;
          elapsed += shot.duration;
          return (
            <fieldset className="work-form" key={index} disabled={busy}>
              <legend>镜头 {index + 1} · {start}–{elapsed} 秒</legend>
              <label>时长（秒）
                <input type="number" min={1} max={30} required value={shot.duration || ''}
                  onChange={(event) => edit(index, { duration: Number(event.target.value) })} />
              </label>
              <label>画面
                <textarea rows={2} maxLength={500} required value={shot.visual}
                  onChange={(event) => edit(index, { visual: event.target.value })} />
              </label>
              <label>文案或旁白
                <input value={shot.narration ?? ''} maxLength={300}
                  onChange={(event) => edit(index, { narration: event.target.value })} />
              </label>
              <label>商品事实依据
                <select multiple size={Math.min(3, Math.max(1, Object.keys(product.facts).length))}
                  value={shot.fact_keys ?? []} onChange={(event) => edit(index, {
                    fact_keys: Array.from(event.target.selectedOptions, (option) => option.value),
                  })}>
                  {Object.entries(product.facts).filter(([, fact]) => fact?.value && fact.evidence)
                    .map(([key, fact]) => (
                      <option key={key} value={key}>{String(fact?.value)} · {fact?.evidence}</option>
                    ))}
                </select>
              </label>
              <div className="work-actions">
                <button type="button" title="移除镜头" aria-label={`移除镜头 ${index + 1}`}
                  disabled={shots.length === 1}
                  onClick={() => setShots((current) => current.filter((_, i) => i !== index))}>
                  <DeleteOutlined />
                </button>
              </div>
            </fieldset>
          );
        })}
        <div className="work-actions">
          <button type="button" disabled={busy || shots.length >= 15}
            onClick={() => setShots([...shots, { duration: Math.max(1, duration - total), visual: '', narration: '' }])}>
            <PlusOutlined aria-hidden="true" /> 添加镜头
          </button>
          <span>总时长 {total} / {duration} 秒</span>
        </div>
        {error && <p role="alert" className="work-error">{error}</p>}
        <div className="work-actions">
          {draft.storyboard && !draft.batch_position_id && (
            <button type="button" disabled={busy} onClick={() => void save(true)}>改为视频片段</button>
          )}
          <button type="submit" className="work-primary" disabled={busy || !position || !valid}>
            确认成片分镜
          </button>
        </div>
      </form>
    </Modal>
  );
}
