import { useEffect, useRef, useState } from 'react';
import {
  AppstoreOutlined,
  BulbOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  MenuOutlined,
  PlusOutlined,
  SettingOutlined,
  ShoppingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

import { roleLabel } from '../auth/session';
import type { Session } from '../auth/session';
import { CaseLibrary } from '../cases/CaseLibrary';
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
import { TaskStudio } from './TaskStudio';
import studioMark from './studio-mark.svg';
import './workspace.css';

type View = 'workbench' | 'tasks' | 'products' | 'current' | 'templates' | 'cases';
const navigation = [
  { view: 'workbench', label: '创作工作台', Icon: ThunderboltOutlined },
  { view: 'tasks', label: '全部任务', Icon: FolderOpenOutlined },
  { view: 'products', label: '商品资料', Icon: ShoppingOutlined },
  { view: 'cases', label: '案例灵感', Icon: BulbOutlined },
  { view: 'templates', label: '公司模板', Icon: SettingOutlined },
  { view: 'current', label: '当前任务', Icon: AppstoreOutlined },
] as const;

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
  const [navigationOpen, setNavigationOpen] = useState(false);
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
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const navigationClose = useRef<HTMLButtonElement>(null);
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
  useEffect(() => {
    if (navigationOpen) navigationClose.current?.focus();
  }, [navigationOpen]);

  function closeNavigation() {
    setNavigationOpen(false);
    navigationTrigger.current?.focus();
  }

  function canLeave() {
    return !creativeDirty || window.confirm('当前创作草稿有未保存的编辑或正在处理。确定离开？');
  }

  function navigate(next: View) {
    if (view !== next && !canLeave()) return;
    taskRequest.current?.abort();
    setLoadingTask(false);
    setTaskError(false);
    setView(next);
    setNavigationOpen(false);
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
          setNavigationOpen(false);
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
      <header className="work-mobile-bar">
        <button
          ref={navigationTrigger}
          type="button"
          aria-label={navigationOpen ? '关闭工作区导航' : '打开工作区导航'}
          aria-expanded={navigationOpen}
          aria-controls="work-sidebar"
          onClick={() => setNavigationOpen(!navigationOpen)}
        >
          {navigationOpen ? <CloseOutlined /> : <MenuOutlined />}
        </button>
        <strong>造物 Studio</strong>
      </header>
      <aside
        id="work-sidebar"
        className="work-sidebar"
        data-open={navigationOpen}
        onKeyDown={(event) => {
          if (navigationOpen && event.key === 'Escape') closeNavigation();
        }}
      >
        <div className="work-brand">
          <img className="work-brand-mark" src={studioMark} alt="" width="32" height="32" />
          <div>
            <strong>造物</strong>
            <small>STUDIO</small>
          </div>
          <button
            ref={navigationClose}
            type="button"
            className="work-sidebar-close"
            aria-label="收起工作区导航"
            onClick={closeNavigation}
          >
            <CloseOutlined />
          </button>
        </div>
        <nav className="work-sidebar-nav" aria-label="工作区">
          {navigation
            .filter(
              (item) =>
                (item.view !== 'templates' || canManage) && (item.view !== 'current' || current),
            )
            .map(({ view: destination, label, Icon }) => (
              <button
                type="button"
                key={destination}
                aria-current={view === destination ? 'page' : undefined}
                onClick={() =>
                  destination === 'current' && current
                    ? openTask(current.id)
                    : navigate(destination)
                }
              >
                <Icon aria-hidden="true" />
                {label}
              </button>
            ))}
        </nav>
        <div className="work-company">
          <h1>{session.tenant.name}</h1>
          <p className="work-muted">{session.email}</p>
          <p className="work-muted">
            <span>{roleLabel[session.role]}</span> · 原件下载
            {session.permissions.includes('download') ? '已授权' : '未授权'}
          </p>
          <button
            type="button"
            onClick={() => {
              if (canLeave()) onLogout();
            }}
            disabled={busy}
          >
            退出登录
          </button>
        </div>
      </aside>
      {navigationOpen && (
        <button
          type="button"
          className="work-sidebar-scrim"
          tabIndex={-1}
          aria-label="关闭侧栏"
          onClick={closeNavigation}
        />
      )}
      <div className="work-main">
        {view !== 'current' && (
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
                      : '公司模板'}
            </h2>
            {canCreate && (view === 'workbench' || view === 'tasks') && (
              <button type="button" className="work-primary" onClick={() => setSetup({})}>
                <PlusOutlined aria-hidden="true" /> 新建制作
              </button>
            )}
          </div>
        )}
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
        {view === 'current' && current && (
          <TaskStudio
            key={current.id}
            task={current}
            categories={categories}
            session={session}
            onDirty={setCreativeDirty}
            onBack={() => navigate('tasks')}
            onNew={() => {
              if (canLeave()) setSetup({});
            }}
          >
            <TaskDetail
              task={current}
              categories={categories}
              token={session.csrf_token}
              canCreate={canCreate}
              onChange={setCurrent}
              onAdd={() => setSetup({ task: current })}
            />
          </TaskStudio>
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
              setView('current');
              setCurrent(task);
              setSetup(undefined);
            }}
          />
        )}
      </div>
    </section>
  );
}
