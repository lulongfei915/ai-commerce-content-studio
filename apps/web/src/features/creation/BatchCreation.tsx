import { useEffect, useState } from 'react';
import { CopyOutlined, PictureOutlined, PlusOutlined } from '@ant-design/icons';

import { Modal } from '../../shared/ui/Modal';
import type { Session } from '../auth/session';
import type { Category } from '../products/api';
import { purposeLabel, type Task } from '../tasks/api';
import { actionError, checkDraft, createDraft, draftWrite, issueText, listDrafts } from './api';
import type { Draft, DraftEdits, Issue } from './api';
import { CreationEditor } from './CreationEditor';
import { TaskResultPicker } from './TaskResultPicker';
import type { TaskResult } from './results';
import './batch-creation.css';

export function BatchCreation({
  task,
  session,
  categories,
  onDirty,
  initialDraft,
}: {
  task: Task;
  session: Session;
  categories: Category[];
  onDirty: (dirty: boolean) => void;
  initialDraft?: string;
}) {
  const [items, setItems] = useState<Draft[]>();
  const [positionId, setPositionId] = useState('');
  const [selection, setSelection] = useState(initialDraft ?? '');
  const [edits, setEdits] = useState<DraftEdits>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'edit' | 'reuse' | 'results' | 'reference' | undefined>(initialDraft ? 'edit' : undefined);
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [retry, setRetry] = useState(0);
  const draft = items?.find((item) => item.id === selection);
  const product = task.products.find((item) => item.id === draft?.product_id);
  const token = session.csrf_token;
  const remaining = task.positions.filter(
    (item) =>
      !items?.some(
        (draft) => draft.product_id === item.product_id && draft.purpose === item.purpose,
      ),
  );
  const position = remaining.find((item) => item.id === positionId) ?? remaining[0];

  useEffect(() => {
    const request = new AbortController();
    void listDrafts(task.id, request.signal, 'batch')
      .then((data) => {
        if (!request.signal.aborted) setItems(data);
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setError(actionError(cause));
      });
    return () => request.abort();
  }, [task.id, retry]);

  useEffect(() => {
    onDirty(Boolean(edits) || busy);
    return () => onDirty(false);
  }, [busy, edits, onDirty]);

  function save(updated: Draft) {
    setItems((current) => {
      const previous = current ?? [];
      return previous.some((item) => item.id === updated.id)
        ? previous.map((item) => (item.id === updated.id ? updated : item))
        : [...previous, updated];
    });
  }

  async function add() {
    if (!position || busy) return;
    setBusy(true);
    setError('');
    try {
      save(await createDraft(task.id, position.product_id, position.purpose, token, true, 'batch'));
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (edits && !window.confirm('放弃当前项未保存的编辑？')) return;
    setEdits(undefined);
    setPanel(undefined);
  }

  async function reference(result: TaskResult) {
    if (!draft || busy) return;
    setBusy(true);
    setReferenceError('');
    try {
      save(
        await draftWrite(draft, token, '/references', {
          kind: 'result',
          source_id: result.version_id,
          file_version: result.file_version,
          source_version: result.version,
        }),
      );
      setPanel(undefined);
    } catch (cause) {
      setReferenceError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="batch-creation" aria-labelledby="batch-heading">
      <header className="work-row batch-heading">
        <h2 id="batch-heading">批量制作</h2>
        <button type="button" onClick={() => setPanel('results')}>
          <PictureOutlined /> 任务作品
        </button>
      </header>
      {error && (
        <p role="alert" className="work-error">
          {error}
          {!items && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              重试
            </button>
          )}
        </p>
      )}
      {items ? (
        <>
          <div className="work-row batch-controls">
            <strong aria-label="批量汇总">
              {new Set(items.map((item) => item.product_id)).size} 个 SKU · 预计{' '}
              {items.reduce(
                (sum, item) => sum + (item.video_parameters ?? item.parameters).count,
                0,
              )}{' '}
              份产出
            </strong>
            {position && (
              <div className="batch-add">
                <select
                  aria-label="批量商品与用途"
                  value={position.id}
                  disabled={busy}
                  onChange={(event) => setPositionId(event.target.value)}
                >
                  {remaining.map((item) => (
                    <option key={item.id} value={item.id}>
                      {task.products.find((p) => p.id === item.product_id)?.sku} ·{' '}
                      {purposeLabel[item.purpose]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="work-primary"
                  disabled={busy}
                  onClick={() => void add()}
                >
                  <PlusOutlined /> 加入批量清单
                </button>
              </div>
            )}
          </div>
          {items.length ? (
            <ul className="batch-items">
              {items.map((item) => (
                <li key={item.id}>
                  <div className="batch-item-summary">
                    <strong>
                      {task.products.find((p) => p.id === item.product_id)?.sku} ·{' '}
                      {purposeLabel[item.purpose]}
                    </strong>
                    <p className="work-muted">{item.prompt || '未填写提示词'}</p>
                    <BatchReadiness key={item.version} draft={item} />
                  </div>
                  <div className="batch-item-actions">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelection(item.id);
                        setPanel('edit');
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelection(item.id);
                        setPanel('reuse');
                      }}
                    >
                      <CopyOutlined /> 复用草稿
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSelection(item.id);
                        setReferenceError('');
                        setPanel('reference');
                      }}
                    >
                      引用作品
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="work-muted">批量清单为空</p>
          )}
        </>
      ) : (
        !error && <p role="status">正在读取批量清单…</p>
      )}
      {(panel === 'results' || panel === 'reference') && (
        <Modal title="任务作品" onClose={close} busy={busy}>
          {referenceError && panel === 'reference' && (
            <p className="work-error" role="alert">
              {referenceError}
            </p>
          )}
          <TaskResultPicker
            task={task}
            sku={panel === 'reference' ? (draft?.product_id ?? '') : ''}
            shownVersions={
              new Set(
                draft?.references
                  .filter((ref) => ref.kind === 'result')
                  .map((ref) => ref.source_id),
              )
            }
            canPlayVideo={session.permissions.includes('download')}
            referenceLabel="引用到此项"
            busy={busy}
            onReference={panel === 'reference' ? (result) => void reference(result) : undefined}
          />
        </Modal>
      )}
      {panel === 'edit' && draft && product && (
        <Modal
          title={`编辑 ${product.sku} · ${purposeLabel[draft.purpose]}`}
          onClose={close}
          busy={busy}
        >
          <CreationEditor
            draft={draft}
            product={product}
            categories={categories}
            token={token}
            edits={edits}
            onEdit={setEdits}
            onSaved={save}
            onBusy={setBusy}
          />
        </Modal>
      )}
      {panel === 'reuse' && draft && (
        <Modal title={`复用草稿到 ${product?.sku ?? ''}`} onClose={close} busy={busy}>
          <ReuseConfiguration
            task={task}
            draft={draft}
            token={token}
            busy={busy}
            onBusy={setBusy}
            onSaved={(updated) => {
              save(updated);
              setPanel(undefined);
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function BatchReadiness({ draft }: { draft: Draft }) {
  const [issues, setIssues] = useState<Issue[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    void checkDraft(draft, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setIssues(value.issues);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      });
    return () => request.abort();
  }, [draft]);
  return (
    <small>
      {error
        ? '核对未完成'
        : issues?.length
          ? issues.map(issueText).join(' · ')
          : issues
            ? '输入已核对'
            : '正在核对输入…'}
    </small>
  );
}

function ReuseConfiguration({
  task,
  draft,
  token,
  busy,
  onBusy,
  onSaved,
}: {
  task: Task;
  draft: Draft;
  token: string;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (draft: Draft) => void;
}) {
  const [sources, setSources] = useState<Draft[]>();
  const [id, setId] = useState('');
  const [error, setError] = useState('');
  const source = sources?.find((item) => item.id === id);
  useEffect(() => {
    const request = new AbortController();
    void Promise.all([
      listDrafts(task.id, request.signal),
      listDrafts(task.id, request.signal, 'canvas'),
    ])
      .then((lists) => {
        if (!request.signal.aborted)
          setSources(lists.flat().filter((item) => item.purpose === draft.purpose));
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setError(actionError(cause));
      });
    return () => request.abort();
  }, [draft.purpose, task.id]);
  async function apply() {
    if (!source || busy) return;
    onBusy(true);
    setError('');
    try {
      onSaved(
        await draftWrite(draft, token, '/reuse', {
          source_id: source.id,
          source_version: source.version,
        }),
      );
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      onBusy(false);
    }
  }
  return (
    <div className="work-form">
      {error && (
        <p role="alert" className="work-error">
          {error}
        </p>
      )}
      {sources?.length ? (
        <>
          <label>
            来源草稿
            <select value={id} disabled={busy} onChange={(event) => setId(event.target.value)}>
              <option value="">请选择</option>
              {sources.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.entry === 'canvas' ? '画布' : '快捷生成'} ·{' '}
                  {task.products.find((product) => product.id === item.product_id)?.sku} ·{' '}
                  {item.prompt.trim().slice(0, 35) || '空提示词'}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="work-primary"
            disabled={busy || !source}
            onClick={() => void apply()}
          >
            覆盖此项配置
          </button>
        </>
      ) : sources ? (
        <p className="work-muted">暂无同用途的来源草稿</p>
      ) : (
        !error && <p role="status">正在读取草稿…</p>
      )}
    </div>
  );
}
