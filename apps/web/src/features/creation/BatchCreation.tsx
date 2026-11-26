import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { ApiError, apiFetch, apiWrite } from '../../shared/api/client';
import type { Session } from '../auth/session';
import type { Category } from '../products/api';
import { purposeLabel, type Task } from '../tasks/api';
import { actionError, createDraft, draftWrite, listDrafts, saveDraftInputs } from './api';
import type { Draft, DraftEdits } from './api';
import { BatchEditor } from './BatchEditor';
import { BatchReadiness, BatchSubmit } from './BatchProgress';
import { BatchOutputs } from './BatchOutputs';
import { useBatchProgress, type BatchConfig, type BatchExecution } from './useBatchProgress';
import { BatchPanel } from './BatchPanel';
import { BatchPublicFields } from './BatchPublicFields';
import { BatchItemScope } from './BatchItemScope';
import { BatchList, BatchListHeader } from './BatchList';
import { BatchTabs, type BatchMedia } from './BatchTabs';
import { batchItemTitle } from './batch-labels';
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
  results,
  resultsError,
  refreshResults,
}: {
  task: Task;
  session: Session;
  categories: Category[];
  onDirty: (dirty: boolean) => void;
  initialDraft?: string;
  results?: TaskResult[];
  resultsError: boolean;
  refreshResults: () => void;
}) {
  const [items, setItems] = useState<Draft[]>();
  const [media, setMedia] = useState<BatchMedia>(
    task.positions.every((item) => item.purpose === 'video') ? 'video' : 'image',
  );
  const [selection, setSelection] = useState(initialDraft ?? '');
  const [edits, setEdits] = useState<DraftEdits>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<'edit' | 'scope' | 'reuse' | 'outputs' | 'reference' | 'public'>();
  const [config, setConfig] = useState<BatchConfig>();
  const [publicEdits, setPublicEdits] = useState<BatchConfig>();
  const [invalid, setInvalid] = useState<string>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const autoOpened = useRef(false);
  const draft = items?.find((item) => item.id === selection);
  const product = task.products.find((item) => item.id === draft?.product_id);
  const token = session.csrf_token;
  const canCreate = session.permissions.includes('create');
  const batchPath = `/tasks/${task.id}/batches/${media}`;
  const progress = useBatchProgress(batchPath, task.id, token);
  const current = items?.filter((item) => (item.purpose === 'video') === (media === 'video')) ?? [];
  const pending = progress.rows ? current.filter((item) => !progress.rows?.some((row) => row.item_id === item.id)) : [];
  const outputRow = progress.rows?.find((row) => row.item_id === selection);
  const total = pending.reduce((sum, item) => {
    const inputs = item.id === selection && edits ? edits.video ?? edits.parameters : item.video_parameters ?? item.parameters;
    return sum + (inputs?.count ?? 1);
  }, 0);
  const positions = task.positions.filter((item) =>
    (item.purpose === 'video') === (media === 'video'),
  );
  const position = positions.find((item) =>
    item.status !== 'adopted' && !current.some((row) => row.batch_position_id === item.id),
  );
  const fallback = positions.find((item) => item.product_id === draft?.product_id && item.purpose === draft.purpose) ?? positions[0];

  useEffect(() => {
    const request = new AbortController();
    void listDrafts(task.id, request.signal, 'batch')
      .then((data) => {
        if (!request.signal.aborted) {
          setItems((previous) => {
            const refreshed = new Map(data.map((item) => [item.id, item]));
            const retained = (previous ?? []).flatMap((item) => {
              const next = refreshed.get(item.id);
              refreshed.delete(item.id);
              return next ? [next] : [];
            });
            return [...retained, ...refreshed.values()];
          });
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
    setConfig(undefined);
    const request = new AbortController();
    void apiFetch<BatchConfig>(batchPath, { signal: request.signal })
      .then((data) => { if (!request.signal.aborted) setConfig(data); })
      .catch(() => {});
    return () => request.abort();
  }, [batchPath]);

  const firstId = current[0]?.id;
  const firstSubmitted = progress.rows?.some((row) => row.item_id === firstId);
  const loaded = Boolean(items && progress.rows);
  useEffect(() => {
    if (!loaded || autoOpened.current) return;
    autoOpened.current = true;
    if (!panel && window.matchMedia('(min-width: 1100px)').matches && firstId && (canCreate || firstSubmitted)) {
      setSelection(firstId);
      setPanel(firstSubmitted ? 'outputs' : 'edit');
    }
  }, [loaded, firstId, firstSubmitted, panel, canCreate]);

  useEffect(() => {
    onDirty(Boolean(edits || publicEdits) || busy);
    return () => onDirty(false);
  }, [busy, edits, publicEdits, onDirty]);

  useLayoutEffect(() => {
    if (panel === 'edit' && invalid === selection && !busy) {
      document.querySelector<HTMLTextAreaElement>('.batch-composer textarea')?.focus({ preventScroll: true });
    }
  }, [busy, invalid, panel, selection]);

  function save(updated: Draft) {
    setInvalid((previous) => previous === updated.id ? undefined : previous);
    setItems((current) => {
      const previous = current ?? [];
      return previous.some((item) => item.id === updated.id)
        ? previous.map((item) => (item.id === updated.id ? updated : item))
        : [...previous, updated];
    });
  }

  async function preserveEdits() {
    if (!draft || !edits) return draft;
    const saved = await saveDraftInputs(draft, token, edits);
    save(saved);
    setEdits(undefined);
    return saved;
  }

  function navigate(action: () => void) {
    if (busy) return;
    if (!edits) {
      action();
      return;
    }
    setBusy(true);
    setError('');
    void preserveEdits().then(action).catch((cause) => setError(actionError(cause)))
      .finally(() => setBusy(false));
  }

  function openItem(item: Draft, next: 'edit' | 'outputs', trigger?: HTMLElement) {
    returnFocus.current = trigger ?? document.getElementById(`batch-open-${item.id}`);
    setSelection(item.id);
    setPanel(next);
    focusPanel();
  }

  function revealItem(id: string) {
    requestAnimationFrame(() => {
      const row = document.getElementById(`batch-${id}`);
      const list = row?.parentElement;
      if (row && list && list.scrollHeight > list.clientHeight) {
        const offset = row.offsetTop - list.scrollTop;
        if (offset < 0) list.scrollTop = row.offsetTop;
        else if (offset + row.offsetHeight > list.clientHeight)
          list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
      }
    });
  }

  async function add(trigger: HTMLButtonElement) {
    const target = position ?? fallback;
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      await preserveEdits();
      const next = await createDraft(task.id, target.product_id, target.purpose, token, false, 'batch', position?.id);
      save(next);
      openItem(next, 'edit', trigger);
      revealItem(next.id);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    navigate(dismiss);
  }
  function dismiss() {
    const trigger = returnFocus.current ?? document.getElementById(`batch-open-${selection}`);
    setPanel(undefined);
    setPublicEdits(undefined);
    requestAnimationFrame(() => {
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>('.batch-list-heading button')?.focus();
    });
  }

  async function reference(result: TaskResult) {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      save(
        await draftWrite(draft, token, '/references', {
          kind: 'result',
          source_id: result.version_id,
          file_version: result.file_version,
          source_version: result.version,
        }),
      );
      setPanel('edit');
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (busy || !pending.length || !progress.rows) return;
    setBusy(true);
    setError('');
    setInvalid(undefined);
    try {
      const saved = await preserveEdits();
      const entries = pending.map(({ id, version }) => ({
        id, expected_version: id === saved?.id ? saved.version : version,
      }));
      const rows = await apiWrite<BatchExecution[]>(`${batchPath}/executions`, token, {
        // Stable across refreshes and retries, even if a response is lost.
        idempotency_key: await submissionKey(entries),
        items: entries,
      });
      progress.update(rows);
      if (window.matchMedia('(min-width: 1100px)').matches) {
        openItem(pending.find((item) => item.id === selection) ?? pending[0], 'outputs');
      } else dismiss();
    } catch (cause) {
      setError(actionError(cause));
      if (cause instanceof ApiError && cause.itemId) {
        setInvalid(cause.itemId);
        const invalidItem = pending.find((item) => item.id === cause.itemId);
        if (invalidItem) {
          returnFocus.current = document.getElementById(`batch-open-${invalidItem.id}`);
          setSelection(invalidItem.id);
          setPanel('edit');
          revealItem(invalidItem.id);
        }
      }
      progress.reload();
    } finally {
      setBusy(false);
    }
  }

  async function publicConfig(trigger: HTMLButtonElement) {
    setBusy(true);
    setError('');
    try {
      await preserveEdits();
      const next = await apiFetch<BatchConfig>(batchPath);
      setConfig(next);
      returnFocus.current = trigger;
      setPanel('public');
      focusPanel();
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function savePublic() {
    if (!publicEdits) return;
    setBusy(true);
    setError('');
    try {
      const updated = await apiWrite<BatchConfig>(batchPath, token, {
        count: publicEdits.count, prompt: publicEdits.prompt, expected_version: publicEdits.version,
        ratio: publicEdits.ratio, resolution: publicEdits.resolution,
      }, 'PUT');
      setConfig(updated);
      dismiss();
      setRetry((n) => n + 1);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copy(item: Draft, trigger: HTMLButtonElement) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await preserveEdits();
      const next = await apiWrite<Draft>(`${batchPath}/items/${item.id}/copy`, token, {
        expected_version: item.id === saved?.id ? saved.version : item.version,
      });
      save(next);
      openItem(next, 'edit', trigger);
      revealItem(next.id);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: Draft) {
    if (busy || !progress.rows || progress.rows.some((row) => row.item_id === item.id)) return;
    setBusy(true);
    setError('');
    try {
      await apiWrite(`${batchPath}/items/${item.id}?expected_version=${item.version}`, token, undefined, 'DELETE');
      const index = current.indexOf(item);
      const next = current[index + 1] ?? current[index - 1];
      setItems((previous) => previous?.filter((entry) => entry.id !== item.id));
      setInvalid((previous) => previous === item.id ? undefined : previous);
      if (selection === item.id) {
        setSelection('');
        setEdits(undefined);
        if (panel !== 'public') setPanel(undefined);
      }
      requestAnimationFrame(() => {
        const target = next && document.getElementById(`batch-open-${next.id}`);
        (target || document.querySelector<HTMLButtonElement>('.batch-list-heading button'))?.focus();
      });
    } catch (cause) {
      setError(actionError(cause));
      if (cause instanceof ApiError && cause.code === 'batch_item_submitted') progress.reload();
    } finally {
      setBusy(false);
    }
  }

  const itemTitle = draft ? batchItemTitle(draft, current.indexOf(draft)) : '';
  const subview = panel === 'scope' ? '商品与用途' : panel === 'reference' ? '选择参考'
    : panel === 'reuse' ? '复用草稿' : panel === 'outputs' ? '生成结果' : undefined;
  const panelTitle = panel === 'public' ? '公共设置' : itemTitle;
  const canGoBack = panel === 'scope' || panel === 'reference' || panel === 'reuse';
  const alert = error && (
    <p role="alert" className="work-error batch-error">
      {error}
      {!items && <button type="button" onClick={() => {
        setError('');
        setRetry((value) => value + 1);
      }}>重试</button>}
    </p>
  );

  return (
    <section className="batch-creation" aria-label="批量制作">
      <BatchTabs media={media} busy={busy} onChange={(next) => {
        if (next === media) return;
        navigate(() => {
          autoOpened.current = false;
          returnFocus.current = null;
          setSelection('');
          setPanel(undefined);
          setPublicEdits(undefined);
          setInvalid(undefined);
          setMedia(next);
          setError('');
        });
      }} />
      <div className="batch-layout" role="tabpanel" id="batch-workspace" aria-labelledby={`batch-tab-${media}`}>
      <div className="batch-main">
        <BatchListHeader media={media} count={current.length} config={config} canCreate={canCreate}
          busy={busy || !loaded} canAdd={Boolean(fallback)}
          onSettings={(trigger) => void publicConfig(trigger)} onAdd={(trigger) => void add(trigger)} />
        {!panel && alert}
        {progress.failed && <p role="alert" className="work-error batch-error">
          批量进度未加载 <button onClick={progress.reload}>重试</button>
        </p>}
        {items ? (
          <BatchList task={task} items={current} rows={progress.rows} results={results}
            selection={panel && panel !== 'public' ? selection : undefined}
            invalid={invalid} busy={busy} canCreate={canCreate}
            onOpen={(item, trigger, row) => navigate(() => openItem(item, row ? 'outputs' : 'edit', trigger))}
            onCopy={(item, trigger) => void copy(item, trigger)} onRemove={(item) => void remove(item)} />
        ) : !error && <p role="status">正在读取批量清单…</p>}
      </div>
      {panel && panelTitle && (
        <BatchPanel title={panelTitle} subtitle={subview} busy={busy} onClose={close}
          onBack={canGoBack ? () => setPanel('edit') : undefined}>
          {alert}
      {(panel === 'edit' || panel === 'scope' || panel === 'reference') && draft && product && progress.rows && !outputRow && canCreate && (
        <div className="batch-editor" key={draft.id}>
          {panel !== 'reference' && <BatchItemScope
            draft={draft} task={task} path={batchPath} token={token}
            busy={busy || Boolean(edits)} onBusy={setBusy} onSaved={save}
            showScope={panel === 'scope'}
            onReuse={() => setPanel('reuse')}
          />}
          {panel !== 'scope' && <BatchEditor
            draft={draft}
            product={product}
            categories={categories}
            token={token}
            edits={edits}
            onEdit={setEdits}
            onSaved={save}
            onBusy={setBusy}
            busy={busy}
            purpose={task.positions.find((item) => item.id === draft.batch_position_id)?.module || purposeLabel[draft.purpose]}
            onScope={() => navigate(() => setPanel('scope'))}
            onReferences={() => navigate(() => setPanel('reference'))}
            references={panel === 'reference' && <>
              <h3>任务作品</h3>
              <TaskResultPicker task={task} sku={draft.product_id} busy={busy}
                shownVersions={new Set(draft.references.filter((ref) => ref.kind === 'result').map((ref) => ref.source_id))}
                canPlayVideo={session.permissions.includes('download')}
                referenceLabel="引用到此项" onReference={(result) => void reference(result)} />
            </>}
          />}
          {panel === 'edit' && <BatchReadiness key={draft.version} draft={draft} />}
        </div>
      )}
      {panel === 'public' && config && (
          <form className="work-form batch-public-form" onSubmit={(event) => { event.preventDefault(); void savePublic(); }}>
            <p className="work-muted">公共设置只更新未提交项中沿用默认的字段。</p>
            <BatchPublicFields config={publicEdits ?? config} image={media === 'image'} busy={busy} onChange={setPublicEdits} />
            <div className="work-actions">
              <button type="submit" className="work-primary" disabled={busy || !publicEdits}>应用到继承项</button>
            </div>
          </form>
      )}
      {panel === 'reuse' && draft && (
          <ReuseConfiguration
            task={task}
            draft={draft}
            token={token}
            busy={busy}
            onBusy={setBusy}
            onSaved={(updated) => {
              save(updated);
              setPanel('edit');
            }}
          />
      )}
      {panel === 'outputs' && outputRow && draft && <BatchOutputs key={outputRow.execution.id}
        row={outputRow} draft={draft} task={task} session={session} busy={busy}
        results={results} resultsError={resultsError} refreshResults={refreshResults}
        onAction={(path) => {
          setBusy(true);
          setError('');
          void progress.outputAction(outputRow.item_id, path)
            .then(refreshResults)
            .catch((cause) => setError(actionError(cause)))
            .finally(() => setBusy(false));
        }}
      />}
        </BatchPanel>
      )}
      </div>
      {canCreate && <BatchSubmit pending={pending} total={total} image={media === 'image'}
        disabled={busy || panel === 'public'} onSubmit={() => void submit()} />}
    </section>
  );
}
function focusPanel() {
  requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(
    '.batch-panel > header button[aria-label="关闭"]',
  )?.focus({ preventScroll: true }));
}
async function submissionKey(items: { id: string; expected_version: number }[]) {
  const bytes = new TextEncoder().encode(JSON.stringify([...items].sort(
    (left, right) => left.id.localeCompare(right.id),
  )));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
