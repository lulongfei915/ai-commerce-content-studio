import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeftOutlined,
  ControlOutlined,
  SafetyOutlined,
  RightOutlined,
  PlusOutlined,
} from '@ant-design/icons';

import type { Session } from '../auth/session';
import { actionError, createDraft, listDrafts } from '../creation/api';
import type { Draft, DraftEdits } from '../creation/api';
import { QuickCreation } from '../creation/QuickCreation';
import { getTaskResults, type TaskResult } from '../creation/results';
import { useImageExecution } from '../creation/useImageExecution';
import { BatchCreation } from '../creation/BatchCreation';
import type { Category, Product } from '../products/api';
import type { Task } from './api';
import { purposeLabel } from './api';
import { Modal } from '../../shared/ui/Modal';
import { photoPreviewUrl } from '../products/preview';
import { StudioResults } from './StudioResults';
import type { CreationEntry } from './entryPreference';
import '../canvas/canvas-workspace.css';

const CanvasPage = lazy(() =>
  import('../canvas/CanvasPage').then(({ CanvasPage }) => ({ default: CanvasPage })),
);

export function TaskStudio({
  session,
  entry,
  task,
  categories,
  initialPosition,
  initialDraft,
  onDirty,
  onBack,
  onReview,
  onNew,
  onProductSaved,
  children,
}: {
  session: Session;
  entry: CreationEntry;
  task: Task;
  categories: Category[];
  initialPosition?: string;
  initialDraft?: string;
  onDirty: (dirty: boolean) => void;
  onBack: () => void;
  onReview?: () => void;
  onNew: () => void;
  onProductSaved: (product: Product) => void;
  children: ReactNode;
}) {
  const quick = entry === 'quick';
  const canvas = entry === 'canvas';
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState(initialDraft ?? (initialPosition ? `new:${initialPosition}` : ''));
  const [targetPosition, setTargetPosition] = useState(initialPosition);
  const [edits, setEdits] = useState<Record<string, DraftEdits>>({});
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [spatialDirty, setSpatialDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const canCreate = session.permissions.includes('create');
  const token = session.csrf_token;
  const [details, setDetails] = useState(false);
  const [results, setResults] = useState<TaskResult[]>();
  const [resultsError, setResultsError] = useState(false);
  const [resultsRetry, setResultsRetry] = useState(0);
  const refreshResults = useCallback(() => setResultsRetry((n) => n + 1), []);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState<{ count: number; media: 'image' | 'video' }>();
  const position = task.positions.find((item) => `new:${item.id}` === active) ?? task.positions[0];
  const target = task.positions.find((item) => item.id === targetPosition);
  const selected =
    drafts.find((item) => item.id === active) ??
    drafts.find(
      (item) =>
        item.product_id === position?.product_id &&
        item.purpose === position?.purpose &&
        item.slot === 'primary',
    );
  const product = task.products.find(
    (item) => item.id === (selected?.product_id ?? position?.product_id),
  );
  const purpose = selected?.purpose ?? position?.purpose;
  const editorId = selected?.id ?? `new:${position?.id}`;
  const imageExecution = useImageExecution(
    canCreate && quick ? selected : undefined,
    token,
    task.id,
    targetPosition,
  );
  useEffect(() => {
    const refresh = (e: Event) => {
      if ((e as CustomEvent).detail === task.id) setResultsRetry((n) => n + 1);
    };
    window.addEventListener('studio-results', refresh);
    return () => window.removeEventListener('studio-results', refresh);
  }, [task.id]);

  useEffect(() => {
    if (canvas) return;
    const request = new AbortController();
    setResultsError(false);
    void getTaskResults(task.id, request.signal)
      .then((items) => {
        if (!request.signal.aborted) setResults(items);
      })
      .catch(() => {
        if (!request.signal.aborted) setResultsError(true);
      });
    return () => request.abort();
  }, [canvas, task.id, resultsRetry]);

  useEffect(() => {
    if (!canCreate || !quick) return;
    const request = new AbortController();
    void listDrafts(task.id, request.signal)
      .then((items) => {
        if (!request.signal.aborted) setDrafts((current) => mergeDrafts(current, items));
      })
      .catch((cause: unknown) => {
        if (!request.signal.aborted) setError(actionError(cause));
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [task.id, retry, canCreate, quick]);

  const busy = editing || creating;
  const dirty = busy || spatialDirty || Object.keys(edits).length > 0;
  useEffect(() => {
    if (entry === 'batch') return;
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, entry, onDirty]);

  const merge = useCallback((items: Draft[]) => {
    setDrafts((current) => mergeDrafts(current, items));
  }, []);
  const save = useCallback((draft: Draft) => merge([draft]), [merge]);
  const edit = useCallback((id: string, next: DraftEdits | undefined) => {
    setEdits((current) => {
      const updated = { ...current };
      if (next) updated[id] = next;
      else delete updated[id];
      return updated;
    });
  }, []);

  async function create(product: string, purpose: Draft['purpose'], primary: boolean) {
    setCreating(true);
    setError('');
    try {
      const draft = await createDraft(task.id, product, purpose, token, primary, entry);
      save(draft);
      setActive(draft.id);
      return draft;
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className={`task-studio task-studio-${entry}`}>
      <header className="task-studio-bar">
        <div className="studio-context">
          <div className="task-studio-title">
            <button
              type="button"
              onClick={onBack}
              aria-label={canvas ? '返回工作台' : '返回全部任务'}
            >
              <ArrowLeftOutlined /> {canvas ? '返回工作台' : '全部任务'}
            </button>
            <span>/</span>
            <h2 title={task.name}>{task.name}</h2>
            <button onClick={() => setDetails(true)} aria-label="任务设置" title="任务设置">
              <ControlOutlined />
            </button>
          </div>
          {quick && product && (
            <label className="studio-product">
              {product.photos[0] && (
                <img src={photoPreviewUrl(product.id, product.photos[0].file_id)} alt="" />
              )}
              <select
                aria-label="创作商品与用途"
                disabled={busy}
                value={editorId}
                onChange={(event) => {
                  setTargetPosition(undefined);
                  setActive(event.target.value);
                }}
              >
                {task.positions
                  .filter(
                    (p) =>
                      !drafts.some(
                        (d) =>
                          d.slot === 'primary' &&
                          d.product_id === p.product_id &&
                          d.purpose === p.purpose,
                      ),
                  )
                  .map((p) => (
                    <option key={p.id} value={`new:${p.id}`}>
                      {task.products.find((item) => item.id === p.product_id)?.name} ·{' '}
                      {purposeLabel[p.purpose]}
                    </option>
                  ))}
                {drafts.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {task.products.find((item) => item.id === d.product_id)?.name} ·{' '}
                    {purposeLabel[d.purpose]}
                    {d.slot !== 'primary' && ` · ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="studio-top-actions">
          {!canvas && canCreate && (
            <button type="button" className="task-studio-new" onClick={onNew}>
              <PlusOutlined aria-hidden="true" /> 新建制作
            </button>
          )}
          {!canvas && results && onReview && (
            <button
              type="button"
              className="studio-review"
              onClick={onReview}
            >
              <SafetyOutlined aria-hidden="true" /> 待审核{' '}
              {results.filter((n) => n.status === 'pending_review').length} 份 <RightOutlined aria-hidden="true" />
            </button>
          )}
        </div>
      </header>
      {error && (
        <p role="alert" className="work-error">
          {error}{' '}
          {quick && (
            <button
              type="button"
              onClick={() => {
                setError('');
                setLoading(true);
                setRetry((value) => value + 1);
              }}
            >
              重试读取草稿
            </button>
          )}
        </p>
      )}
      {quick && (
        <>
          {canCreate && product && purpose && (
            <QuickCreation
              product={product}
              purpose={purpose}
              editorId={editorId}
              categories={categories}
              token={token}
              selected={selected}
              targetSpec={target?.ratio && target.resolution
                ? { ratio: target.ratio, resolution: target.resolution } : undefined}
              edits={edits[editorId]}
              busy={busy}
              loading={loading || Boolean(error)}
              onCreate={create}
              onSaved={save}
              onProductSaved={onProductSaved}
              onEdit={edit}
              onBusy={setEditing}
              execution={imageExecution}
              onSubmitting={(count, media) => {
                setSubmitting(count ? { count, media } : undefined);
                if (count) setStatus('');
              }}
            />
          )}
          {resultsError && (
            <p role="alert">
              创作结果未加载。 <button onClick={() => setResultsRetry((n) => n + 1)}>重试</button>
            </p>
          )}
          {(results || submitting || Object.keys(imageExecution.jobs).length > 0) ? (
            <StudioResults
              results={results ?? []}
              session={session}
              task={task}
              refresh={refreshResults}
              taskId={task.id}
              status={status}
              onStatus={setStatus}
              canPlayVideo={session.permissions.includes('download')}
              imageExecution={imageExecution}
              submittingCount={submitting?.count}
              submittingMedia={submitting?.media}
              imageControlsDisabled={busy}
            />
          ) : !resultsError && (
            <p role="status">正在读取创作结果…</p>
          )}
          {!canCreate && children}
        </>
      )}
      {details && (
        <Modal title="任务设置" onClose={() => setDetails(false)}>
          {children}
        </Modal>
      )}
      {entry === 'batch' && (
        <BatchCreation task={task} session={session} categories={categories} onDirty={onDirty}
          initialDraft={initialDraft} results={results} resultsError={resultsError} refreshResults={refreshResults} />
      )}
      {canvas && (
        <Suspense fallback={<p role="status">正在加载画布…</p>}>
          <CanvasPage
            task={task}
            categories={categories}
            session={session}
            active={active}
            edits={edits}
            drafts={drafts}
            busy={busy}
            onSelect={setActive}
            onCreate={create}
            onEdit={edit}
            onSaved={save}
            onMerge={merge}
            onBusy={setEditing}
            onSpatialDirty={setSpatialDirty}
          />
        </Suspense>
      )}
    </section>
  );
}

function mergeDrafts(current: Draft[], items: Draft[]) {
  const index = new Map(current.map((draft) => [draft.id, draft]));
  let changed = false;
  for (const draft of items) {
    const existing = index.get(draft.id);
    if (!existing || existing.version < draft.version) {
      index.set(draft.id, draft);
      changed = true;
    }
  }
  return changed ? [...index.values()] : current;
}
