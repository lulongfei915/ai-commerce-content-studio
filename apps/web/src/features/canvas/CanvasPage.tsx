import { useCallback, useEffect, useRef, useState } from 'react';

import type { Session } from '../auth/session';
import { actionError } from '../creation/api';
import type { Draft, DraftEdits } from '../creation/api';
import type { Category } from '../products/api';
import type { Task } from '../tasks/api';
import { CanvasBoard } from './CanvasBoard';
import { getCanvas, putLayout, putViewport } from './api';
import type { Canvas, Positions, Viewport } from './api';
import { useVersionedSave } from './useVersionedSave';
import './canvas.css';

const initialViewport = { x: 0, y: 0, zoom: 1 };

export type CanvasProps = {
  task: Task;
  categories: Category[];
  session: Session;
  active: string;
  drafts: Draft[];
  edits: Record<string, DraftEdits>;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: (
    product: string,
    purpose: Draft['purpose'],
    primary: boolean,
  ) => Promise<Draft | undefined>;
  onEdit: (id: string, edits: DraftEdits | undefined) => void;
  onSaved: (draft: Draft) => void;
  onMerge: (drafts: Draft[]) => void;
  onBusy: (busy: boolean) => void;
  onSpatialDirty: (dirty: boolean) => void;
};

export function CanvasPage(props: CanvasProps) {
  const { task, onMerge } = props;
  const [canvas, setCanvas] = useState<Canvas>();
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const requestId = useRef(0);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const request = ++requestId.current;
      const updated = await getCanvas(task.id, signal);
      if (!signal?.aborted && request === requestId.current) {
        setCanvas(updated);
        onMerge(updated.creations);
        setError('');
      }
      return updated;
    },
    [task.id, onMerge],
  );

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      void load(controller.signal).catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(actionError(cause));
      });
    const resultsChanged = (event: Event) => {
      if ((event as CustomEvent).detail === task.id) refresh();
    };
    refresh();
    window.addEventListener('studio-results', resultsChanged);
    return () => {
      window.removeEventListener('studio-results', resultsChanged);
      controller.abort();
    };
  }, [retry, load, task.id]);
  const running = canvas?.nodes.some((node) =>
    ['queued', 'running', 'generating', 'saving'].includes(node.status),
  );
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void load(controller.signal).catch(() => {});
    }, 5000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [running, load]);

  return (
    <div>
      {error && (
        <p role="alert" className="work-error">
          {error}{' '}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            重试读取画布
          </button>
        </p>
      )}
      {!canvas && !error && <p role="status">正在加载画布…</p>}
      {canvas && <CanvasState {...props} canvas={canvas} reload={load} />}
    </div>
  );
}

function CanvasState(props: CanvasProps & { canvas: Canvas; reload: () => Promise<Canvas> }) {
  const { task, canvas, session, onSpatialDirty, reload } = props;
  const token = session.csrf_token;
  const layout = useVersionedSave<Positions>(
    canvas.layout.positions ?? [],
    canvas.layout.version ?? 0,
    async (version, next) => {
      const saved = await putLayout(task.id, token, version, next);
      const before = new Set((canvas.layout.positions ?? []).map((point) => point.id));
      const after = new Set(next.map((point) => point.id));
      const isAsset = (id: string) => !id.startsWith('creation:');
      if (
        [...before].some((id) => isAsset(id) && !after.has(id)) ||
        [...after].some((id) => isAsset(id) && !before.has(id))
      ) {
        void reload().catch(() => {});
      }
      return saved;
    },
  );
  const { version: viewportVersion, ...coordinates } = canvas.viewport ?? {
    ...initialViewport,
    version: 0,
  };
  const viewport = useVersionedSave<Viewport>(coordinates, viewportVersion, (version, next) =>
    putViewport(task.id, token, version, next),
  );
  const dirty = layout.state !== 'saved' || viewport.state !== 'saved';
  useEffect(() => {
    onSpatialDirty(dirty);
  }, [dirty, onSpatialDirty]);
  return <CanvasBoard {...props} layout={layout} viewport={viewport} reload={reload} />;
}

export type SaveQueue<T> = ReturnType<typeof useVersionedSave<T>>;
