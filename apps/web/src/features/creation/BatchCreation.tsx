import { useEffect, useState } from 'react';
import { CopyOutlined, PictureOutlined, PlusOutlined, SendOutlined, SettingOutlined } from '@ant-design/icons';

import { ApiError, apiFetch, apiWrite } from '../../shared/api/client';
import type { Session } from '../auth/session';
import type { Category } from '../products/api';
import { purposeLabel, type Task } from '../tasks/api';
import { actionError, createDraft, draftWrite, listDrafts } from './api';
import type { Draft, DraftEdits } from './api';
import { CreationEditor } from './CreationEditor';
import { BatchOutputs, BatchReadiness } from './BatchProgress';
import { useBatchProgress, type BatchConfig, type BatchExecution } from './useBatchProgress';
import { BatchPanel } from './BatchPanel';
import { BatchPublicFields } from './BatchPublicFields';
import { BatchItemScope } from './BatchItemScope';
import { ReuseConfiguration } from './ReuseBatchConfiguration';
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
  const [media, setMedia] = useState<'image' | 'video'>(
    task.positions.every((item) => item.purpose === 'video') ? 'video' : 'image',
  );
  const [positionId, setPositionId] = useState('');
  const [extra, setExtra] = useState(false);
  const [selection, setSelection] = useState(initialDraft ?? '');
  const [edits, setEdits] = useState<DraftEdits>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'edit' | 'reuse' | 'results' | 'reference' | 'public'>();
  const [resultId, setResultId] = useState<string>();
  const [config, setConfig] = useState<BatchConfig>();
  const [invalid, setInvalid] = useState<string>();
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [retry, setRetry] = useState(0);
  const draft = items?.find((item) => item.id === selection);
  const product = task.products.find((item) => item.id === draft?.product_id);
  const token = session.csrf_token;
  const canCreate = session.permissions.includes('create');
  const batchPath = `/tasks/${task.id}/batches/${media}`;
  const progress = useBatchProgress(batchPath, task.id, token);
  const current = items?.filter((item) => (item.purpose === 'video') === (media === 'video')) ?? [];
  const pending = current.filter((item) => !progress.rows?.some((row) => row.item_id === item.id));
  const positions = task.positions.filter((item) =>
    (item.purpose === 'video') === (media === 'video'),
  );
  const remaining = positions.filter((item) =>
    extra || (item.status !== 'adopted' && !current.some((row) => row.batch_position_id === item.id)),
  );
  const position = remaining.find((item) => item.id === positionId) ?? remaining[0];

  useEffect(() => {
    const request = new AbortController();
    void listDrafts(task.id, request.signal, 'batch')
      .then((data) => {
        if (!request.signal.aborted) {
          setItems(data);
          const target = data.find((item) => item.id === initialDraft);
          if (target && retry === 0) {
            setMedia(target.purpose === 'video' ? 'video' : 'image');
            setPanel('edit');
          }
        }
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setError(actionError(cause));
      });
    return () => request.abort();
  }, [initialDraft, task.id, retry]);

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
      save(await createDraft(
        task.id, position.product_id, position.purpose, token, false, 'batch',
        extra ? undefined : position.id,
      ));
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (!confirmClose()) return;
    setEdits(undefined);
    setPanel(undefined);
  }

  function confirmClose() {
    return !edits || window.confirm('放弃当前项未保存的编辑？');
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

  async function submit() {
    if (busy || !pending.length || !progress.rows) return;
    setBusy(true);
    setError('');
    setInvalid(undefined);
    const entries = pending.map(({ id, version }) => ({ id, expected_version: version }));
    try {
      const rows = await apiWrite<BatchExecution[]>(`${batchPath}/executions`, token, {
        // Stable across refreshes and retries, even if a response is lost.
        idempotency_key: await submissionKey(entries),
        items: entries,
      });
      progress.update(rows);
    } catch (cause) {
      setError(actionError(cause));
      if (cause instanceof ApiError && cause.itemId) {
        setInvalid(cause.itemId);
        document.getElementById(`batch-${cause.itemId}`)?.focus();
        setSelection(cause.itemId);
        setPanel('edit');
      }
      progress.reload();
    } finally {
      setBusy(false);
    }
  }

  async function publicConfig() {
    setBusy(true);
    setError('');
    try {
      setConfig(await apiFetch<BatchConfig>(batchPath));
      setPanel('public');
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function savePublic() {
    if (!config) return;
    setBusy(true);
    setError('');
    try {
      await apiWrite(batchPath, token, {
        count: config.count, prompt: config.prompt, expected_version: config.version,
        ratio: config.ratio, resolution: config.resolution,
      }, 'PUT');
      setPanel(undefined);
      setRetry((n) => n + 1);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copy(item: Draft) {
    setBusy(true);
    setError('');
    try {
      const next = await apiWrite<Draft>(`${batchPath}/items/${item.id}/copy`, token, {
        expected_version: item.version,
      });
      save(next);
      setSelection(next.id);
      setPanel('edit');
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="batch-creation" aria-labelledby="batch-heading">
      <div className="batch-main">
      <header className="work-row batch-heading">
        <h2 id="batch-heading">批量制作</h2>
        <div className="batch-modes" aria-label="批量类型">
          {(['image', 'video'] as const).map((type) => (
            <button key={type} type="button" aria-pressed={media === type} disabled={busy}
              onClick={() => {
                if (type === media || !confirmClose()) return;
                setEdits(undefined);
                setPanel(undefined);
                setMedia(type);
                setError('');
              }}>
              {type === 'image' ? '图片' : '视频'}
            </button>
          ))}
        </div>
        <button type="button" disabled={busy || Boolean(edits)}
          onClick={() => { setResultId(undefined); setPanel('results'); }}>
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
              {pending.length} 项 · {new Set(pending.map((item) => item.product_id)).size} 个 SKU · 预计{' '}
              {pending.reduce(
                (sum, item) => sum + (item.video_parameters ?? item.parameters).count,
                0,
              )}{' '}
              份产出
            </strong>
            {canCreate && position && (
              <div className="batch-add">
                <select
                  aria-label="批量商品与用途"
                  value={position.id}
                  disabled={busy || Boolean(edits)}
                  onChange={(event) => setPositionId(event.target.value)}
                >
                  {remaining.map((item) => (
                    <option key={item.id} value={item.id}>
                      {task.products.find((p) => p.id === item.product_id)?.sku} ·{' '}
                      {item.module || purposeLabel[item.purpose]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="work-primary"
                  disabled={busy || Boolean(edits)}
                  onClick={() => void add()}
                >
                  <PlusOutlined /> 加入批量清单
                </button>
              </div>
            )}
            {canCreate && <button disabled={busy || Boolean(edits)} onClick={() => void publicConfig()}>
              <SettingOutlined /> 公共设置
            </button>}
            {canCreate && positions.length > 0 && (
              <label className="work-check">
                <input type="checkbox" checked={extra} disabled={busy || Boolean(edits)}
                  onChange={(event) => setExtra(event.target.checked)} />
                独立候选
              </label>
            )}
          </div>
          {progress.failed && <p role="alert">
            批量进度未加载 <button onClick={progress.reload}>重试</button>
          </p>}
          {current.length ? (
            <ul className="batch-items" aria-label="批量清单">
              {current.map((item) => {
                const row = progress.rows?.find((entry) => entry.item_id === item.id);
                const slot = task.positions.find((p) => p.id === item.batch_position_id);
                return (
                <li key={item.id} id={`batch-${item.id}`} tabIndex={-1}
                  className={invalid === item.id ? 'batch-invalid' : undefined}>
                  <div className="batch-item-summary">
                    <strong>
                      {task.products.find((p) => p.id === item.product_id)?.sku} ·{' '}
                      {slot?.module || purposeLabel[item.purpose]}
                    </strong>
                    <p className="work-muted">{item.prompt || '未填写提示词'}</p>
                    {!row && <BatchReadiness key={item.version} draft={item} />}
                  </div>
                  {row ? <BatchOutputs row={row} busy={busy} canCreate={canCreate}
                    onOpen={(id) => { setResultId(id); setPanel('results'); }}
                    onAction={(path) => {
                      setBusy(true);
                      setError('');
                      void progress.outputAction(item.id, path)
                        .catch((cause) => setError(actionError(cause)))
                        .finally(() => setBusy(false));
                    }}
                  /> : canCreate && progress.rows && <div className="batch-item-actions">
                    <button
                      type="button"
                      disabled={busy || Boolean(edits)}
                      onClick={() => {
                        setSelection(item.id);
                        setPanel('edit');
                      }}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={busy || Boolean(edits)}
                      onClick={() => {
                        setSelection(item.id);
                        setPanel('reuse');
                      }}
                    >
                      <CopyOutlined /> 复用草稿
                    </button>
                    <button
                      type="button"
                      disabled={busy || Boolean(edits)}
                      onClick={() => {
                        setSelection(item.id);
                        setReferenceError('');
                        setPanel('reference');
                      }}
                    >
                      引用作品
                    </button>
                  </div>}
                  {canCreate && progress.rows && (
                    <button type="button" title="复制生成项" aria-label="复制生成项"
                      disabled={busy || Boolean(edits)} onClick={() => void copy(item)}>
                      <CopyOutlined />
                    </button>
                  )}
                </li>
              );})}
            </ul>
          ) : (
            <p className="work-muted">批量清单为空</p>
          )}
          {canCreate && <footer className="batch-submit work-actions">
            {media === 'image' ? <button className="work-primary"
              disabled={busy || Boolean(edits) || !pending.length || !progress.rows}
              onClick={() => void submit()}>
              <SendOutlined /> 提交批量图片（{pending.length} 项）
            </button> : <span className="work-muted">视频制作待分镜确认</span>}
          </footer>}
        </>
      ) : (
        !error && <p role="status">正在读取批量清单…</p>
      )}
      </div>
      {(panel === 'results' || panel === 'reference') && (
        <BatchPanel title="任务作品" onClose={close} busy={busy} key={panel}>
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
            initialVersion={resultId}
            referenceLabel="引用到此项"
            busy={busy}
            onReference={panel === 'reference' ? (result) => void reference(result) : undefined}
          />
        </BatchPanel>
      )}
      {panel === 'edit' && draft && product && progress.rows &&
        !progress.rows.some((row) => row.item_id === draft.id) && (
        <BatchPanel
          title={`编辑 ${product.sku} · ${purposeLabel[draft.purpose]}`}
          onClose={close}
          busy={busy}
          key={draft.id}
        >
          <BatchItemScope
            draft={draft} task={task} path={batchPath} token={token}
            busy={busy || Boolean(edits)} onBusy={setBusy} onSaved={save}
            onRemoved={() => {
              setItems((previous) => previous?.filter((item) => item.id !== draft.id));
              close();
            }}
          />
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
        </BatchPanel>
      )}
      {panel === 'public' && config && (
        <BatchPanel title="公共设置" onClose={close} busy={busy}>
          <form className="work-form" onSubmit={(event) => { event.preventDefault(); void savePublic(); }}>
            <BatchPublicFields config={config} image={media === 'image'} busy={busy} onChange={setConfig} />
            {error && <p role="alert">{error}</p>}
            <div className="work-actions">
              <button type="submit" className="work-primary" disabled={busy}>应用到继承项</button>
            </div>
          </form>
        </BatchPanel>
      )}
      {panel === 'reuse' && draft && (
        <BatchPanel title={`复用草稿到 ${product?.sku ?? ''}`} onClose={close} busy={busy}>
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
        </BatchPanel>
      )}
    </section>
  );
}
async function submissionKey(items: { id: string; expected_version: number }[]) {
  const bytes = new TextEncoder().encode(JSON.stringify([...items].sort(
    (left, right) => left.id.localeCompare(right.id),
  )));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
