import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import type { Session } from '../auth/session';
import { actionError, createDraft, listDrafts } from '../creation/api';
import type { Draft } from '../creation/api';
import type { DraftEdits } from '../creation/CreationEditor';
import { QuickCreation } from '../creation/QuickCreation';
import type { Category } from '../products/api';
import type { Task } from './api';

const CanvasPage = lazy(() =>
  import('../canvas/CanvasPage').then(({ CanvasPage }) => ({ default: CanvasPage })),
);

export function TaskStudio({
  session,
  task,
  categories,
  onDirty,
  children,
}: {
  session: Session;
  task: Task;
  categories: Category[];
  onDirty: (dirty: boolean) => void;
  children: ReactNode;
}) {
  const [mode, setMode] = useState<'quick' | 'canvas'>('quick');
  const [opened, setOpened] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [active, setActive] = useState('');
  const [edits, setEdits] = useState<Record<string, DraftEdits>>({});
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [spatialDirty, setSpatialDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const canCreate = session.permissions.includes('create');
  const token = session.csrf_token;

  useEffect(() => {
    if (!canCreate) return;
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
  }, [task.id, retry, canCreate]);

  const busy = editing || creating;
  const dirty = busy || spatialDirty || Object.keys(edits).length > 0;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty, onDirty]);

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
      const draft = await createDraft(task.id, product, purpose, token, primary);
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
    <section className="task-studio">
      <nav className="work-nav" aria-label="创作入口">
        <button
          type="button"
          disabled={busy}
          aria-current={mode === 'quick' ? 'page' : undefined}
          onClick={() => setMode('quick')}
        >
          {canCreate ? '快捷创作' : '任务详情'}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-current={mode === 'canvas' ? 'page' : undefined}
          onClick={() => {
            setOpened(true);
            setMode('canvas');
          }}
        >
          画布
        </button>
      </nav>
      {error && (
        <p role="alert" className="work-error">
          {error}{' '}
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
        </p>
      )}
      {mode === 'quick' && (
        <>
          {canCreate && (
            <QuickCreation
              task={task}
              categories={categories}
              token={token}
              drafts={drafts}
              selected={drafts.find((draft) => draft.id === active)}
              edits={edits[active]}
              busy={busy}
              loading={loading}
              onSelect={setActive}
              onCreate={create}
              onSaved={save}
              onEdit={edit}
              onBusy={setEditing}
            />
          )}
          {children}
        </>
      )}
      {opened && (
        <Suspense fallback={<p role="status">正在加载画布…</p>}>
          <CanvasPage
            shown={mode === 'canvas'}
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
