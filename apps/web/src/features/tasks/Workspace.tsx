import { useEffect, useRef, useState } from 'react';

import { roleLabel } from '../auth/session';
import type { Session } from '../auth/session';
import { CaseLibrary } from '../cases/CaseLibrary';
import { QuickCreation } from '../creation/QuickCreation';
import { TemplateManager } from '../templates/TemplateManager';
import { ProductCatalog } from '../products/ProductCatalog';
import { ProductEditor } from '../products/ProductEditor';
import { productCategories } from '../products/api';
import type { Category, Product } from '../products/api';
import { getTask } from './api';
import type { Task } from './api';
import { TaskDetail } from './TaskDetail';
import { TaskList } from './TaskList';
import { TaskSetup } from './TaskSetup';
import './workspace.css';

type View = 'workbench' | 'tasks' | 'products' | 'current' | 'templates' | 'cases';

export function Workspace({
  session,
  busy,
  error,
  onLogout,
}: {
  session: Session;
  busy: boolean;
  error: string | null;
  onLogout: () => void;
}) {
  const [view, setView] = useState<View>('workbench');
  const [current, setCurrent] = useState<Task>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState(false);
  const [categoryRetry, setCategoryRetry] = useState(0);
  const [setup, setSetup] = useState<{ initial?: Product; task?: Task }>();
  const [editor, setEditor] = useState<{ product?: Product }>();
  const [revision, setRevision] = useState(0);
  const [taskError, setTaskError] = useState(false);
  const [loadingTask, setLoadingTask] = useState(false);
  const taskRequest = useRef<AbortController>();
  const [creativeDirty, setCreativeDirty] = useState(false);
  const canManage = session.permissions.includes('manage');
  const canCreate = session.permissions.includes('create');

  useEffect(() => {
    const request = new AbortController();
    void productCategories(request.signal)
      .then((items) => {
        if (!request.signal.aborted) setCategories(items);
      })
      .catch(() => {
        if (!request.signal.aborted) setCategoryError(true);
      });
    return () => request.abort();
  }, [categoryRetry]);
  useEffect(() => () => taskRequest.current?.abort(), []);

  function canLeave() {
    return !creativeDirty || window.confirm('当前创作草稿有未保存的编辑或正在处理。确定离开？');
  }

  function navigate(next: View) {
    if (view !== next && !canLeave()) return;
    taskRequest.current?.abort();
    setLoadingTask(false);
    setTaskError(false);
    setView(next);
  }

  function openTask(id: string) {
    if (!canLeave()) return;
    taskRequest.current?.abort();
    const request = new AbortController();
    taskRequest.current = request;
    setLoadingTask(true);
    setTaskError(false);
    void getTask(id, request.signal)
      .then((task) => {
        if (!request.signal.aborted) {
          setCurrent(task);
          setView('current');
        }
      })
      .catch(() => {
        if (!request.signal.aborted) setTaskError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoadingTask(false);
      });
  }

  return (
    <section className="workspace">
      <header className="work-row work-company">
        <div>
          <h1>{session.tenant.name}</h1>
          <p className="work-muted">
            {session.email} <span>{roleLabel[session.role]}</span> · 原件下载
            {session.permissions.includes('download') ? '已授权' : '未授权'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (canLeave()) onLogout();
          }}
          disabled={busy}
        >
          退出登录
        </button>
      </header>
      <nav className="work-nav" aria-label="工作区">
        <button
          type="button"
          aria-current={view === 'workbench' ? 'page' : undefined}
          onClick={() => navigate('workbench')}
        >
          工作台
        </button>
        <button
          type="button"
          aria-current={view === 'tasks' ? 'page' : undefined}
          onClick={() => navigate('tasks')}
        >
          全部任务
        </button>
        <button
          type="button"
          aria-current={view === 'products' ? 'page' : undefined}
          onClick={() => navigate('products')}
        >
          商品资料
        </button>
        <button
          type="button"
          aria-current={view === 'cases' ? 'page' : undefined}
          onClick={() => navigate('cases')}
        >
          案例库
        </button>
        {canManage && (
          <button
            type="button"
            aria-current={view === 'templates' ? 'page' : undefined}
            onClick={() => navigate('templates')}
          >
            公司模板
          </button>
        )}
        {current && (
          <button
            type="button"
            aria-current={view === 'current' ? 'page' : undefined}
            onClick={() => openTask(current.id)}
          >
            当前任务
          </button>
        )}
      </nav>
      <div className="work-row work-title">
        <h2>
          {view === 'workbench'
            ? '工作台'
            : view === 'tasks'
              ? '全部任务'
              : view === 'products'
                ? '商品资料'
                : view === 'cases'
                  ? '案例库'
                  : view === 'templates'
                    ? '公司模板'
                    : current?.name}
        </h2>
        {canCreate && (view === 'workbench' || view === 'tasks') && (
          <button type="button" className="work-primary" onClick={() => setSetup({})}>
            新建制作
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="work-error">
          {error}
        </p>
      )}
      {categoryError && (
        <p role="alert" className="work-error">
          品类字段未加载。{' '}
          <button
            type="button"
            onClick={() => {
              setCategoryError(false);
              setCategoryRetry((value) => value + 1);
            }}
          >
            重试
          </button>
        </p>
      )}
      {loadingTask && <p role="status">正在加载任务…</p>}
      {taskError && (
        <p role="alert" className="work-error">
          任务未加载，请重试。
        </p>
      )}
      {view === 'workbench' && (
        <div className="work-card work-row">
          <p>{current ? `当前任务 · ${current.name}` : '选择商品和本次所需内容，开始制作。'}</p>
          {current && (
            <button type="button" onClick={() => openTask(current.id)}>
              继续创作
            </button>
          )}
        </div>
      )}
      {view === 'tasks' && <TaskList onOpen={openTask} />}
      {view === 'cases' && (
        <CaseLibrary
          categories={categories}
          token={session.csrf_token}
          canManage={canManage}
          canPlayVideo={session.permissions.includes('download')}
        />
      )}
      {view === 'templates' && canManage && (
        <TemplateManager categories={categories} token={session.csrf_token} />
      )}
      {view === 'current' && current && canCreate && (
        <QuickCreation
          key={`creative-${current.id}`}
          task={current}
          categories={categories}
          token={session.csrf_token}
          onDirty={setCreativeDirty}
        />
      )}

      {view === 'current' && current && (
        <TaskDetail
          key={current.id}
          task={current}
          categories={categories}
          token={session.csrf_token}
          canCreate={canCreate}
          onChange={setCurrent}
          onAdd={() => setSetup({ task: current })}
        />
      )}
      {view === 'products' && (
        <ProductCatalog
          categories={categories}
          canCreate={canCreate}
          revision={revision}
          onCreate={() => setEditor({})}
          onEdit={(product) => setEditor({ product })}
          onStart={(initial) => setSetup({ initial })}
        />
      )}
      {editor && (
        <ProductEditor
          categories={categories}
          product={editor.product}
          token={session.csrf_token}
          onClose={() => setEditor(undefined)}
          onSave={(product, start) => {
            setRevision((value) => value + 1);
            setEditor(undefined);
            if (start) setSetup({ initial: product });
          }}
        />
      )}
      {setup && (
        <TaskSetup
          {...setup}
          categories={categories}
          token={session.csrf_token}
          onClose={() => setSetup(undefined)}
          onSave={(task) => {
            navigate('current');
            setCurrent(task);
            setSetup(undefined);
          }}
        />
      )}
    </section>
  );
}
