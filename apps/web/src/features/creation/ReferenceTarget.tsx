import { useEffect, useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import type { CreativeCase } from '../cases/api';
import { purposeLabel, type Task } from '../tasks/api';
import { listDrafts, draftWrite, removeReference, actionError, type Draft } from './api';
import type { TaskResult } from './results';

export function ReferenceTarget({
  task,
  source,
  token,
  onClose,
  onSaved,
  existingDrafts,
}: {
  task: Task;
  source: CreativeCase | TaskResult;
  token: string;
  onClose: () => void;
  onSaved: (draft: Draft, removed: boolean) => void;
  existingDrafts?: Draft[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>();
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const ctl = new AbortController();
    void (
      existingDrafts
        ? Promise.resolve([existingDrafts])
        : Promise.all(
            (['quick', 'canvas', 'batch'] as const).map((entry) =>
              listDrafts(task.id, ctl.signal, entry),
            ),
          )
    )
      .then((groups) => {
        if (ctl.signal.aborted) return;
        const compatible = groups
          .flat()
          .filter((draft) =>
            'category' in source
              ? task.products.find((p) => p.id === draft.product_id)?.category ===
                  source.category &&
                source.usage_purposes?.includes(draft.purpose) &&
                (source.media === 'image' || draft.purpose === 'video')
              : draft.product_id === source.product_id &&
                draft.id !== source.creation_id &&
                (source.media === 'image' || draft.purpose === 'video') &&
                source.referenceable,
          );
        setDrafts(compatible);
        const added = compatible.find(
          (d) =>
            'category' in source &&
            d.references.some((r) => r.kind === 'case' && r.source_id === source.id),
        );
        setTarget(added?.id ?? compatible[0]?.id ?? '');
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      });
    return () => ctl.abort();
  }, [task, source, existingDrafts]);
  const draft = drafts?.find((d) => d.id === target);
  const existing =
    'category' in source &&
    draft?.references.find((r) => r.kind === 'case' && r.source_id === source.id);
  return (
    <Modal title={existing ? '管理已添加参考' : '添加参考至制作'} busy={busy} onClose={onClose}>
      <div className="work-form">
        <strong>{task.name}</strong>
        {drafts?.length ? (
          <label>
            目标草稿
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {drafts.map((d) => (
                <option key={d.id} value={d.id}>
                  {{ quick: '快捷生成', canvas: '画布', batch: '批量制作' }[d.entry ?? 'quick']} ·{' '}
                  {task.products.find((p) => p.id === d.product_id)?.sku} ·{' '}
                  {purposeLabel[d.purpose]} · {d.prompt.slice(0, 25) || d.id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>{drafts ? '当前任务没有匹配的草稿。' : !error && '正在读取草稿…'}</p>
        )}
        {error && <p role="alert">{error}</p>}
        <button
          className="work-primary"
          disabled={!draft || busy || (!!existing && existing.origin === 'template')}
          onClick={async () => {
            if (!draft) return;
            setBusy(true);
            setError('');
            try {
              const updated = existing
                ? await removeReference(draft, token, existing.id)
                : await draftWrite(
                    draft,
                    token,
                    '/references',
                    'category' in source
                      ? { kind: 'case', source_id: source.id }
                      : {
                          kind: 'result',
                          source_id: source.version_id,
                          source_version: source.version,
                          file_version: source.file_version,
                        },
                  );
              onSaved(updated, !!existing);
            } catch (e) {
              setError(actionError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {existing ? (existing.origin === 'template' ? '模板附带参考' : '确认移除') : '确认添加'}
        </button>
      </div>
    </Modal>
  );
}
