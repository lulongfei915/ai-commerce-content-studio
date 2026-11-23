import { useEffect, useRef, useState } from 'react';
import { Tooltip } from 'antd';
import { ApiError } from '../../shared/api/client';
import {
  ApartmentOutlined,
  AppstoreOutlined,
  BulbOutlined,
  CloseOutlined,
  FolderOpenOutlined,
  LogoutOutlined,
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
import { getTask, listTasks } from './api';
import type { Task } from './api';
import { TaskDetail } from './TaskDetail';
import { TaskList } from './TaskList';
import { TaskSetup } from './TaskSetup';
import { TaskStudio } from './TaskStudio';
import {
  readEntry,
  readTaskPreference,
  rememberEntry,
  rememberTask,
  type CreationEntry,
} from './entryPreference';
import { useSidebarLayout } from './useSidebarLayout';
import studioMark from './studio-mark.svg';
import './workspace.css';
import { StudioResults } from './StudioResults';
import './home.css';

type View = CreationEntry | 'tasks' | 'products' | 'templates' | 'cases';
const navigation = [
  { view: 'tasks', label: '全部任务', Icon: FolderOpenOutlined },
  { view: 'products', label: '商品资料', Icon: ShoppingOutlined },
  { view: 'cases', label: '案例灵感', Icon: BulbOutlined },
  { view: 'templates', label: '公司模板', Icon: SettingOutlined },
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
  const [entry, setEntry] = useState(() => readEntry(session));
  const [view, setView] = useState<View>(entry);
  const workbench = isCreationEntry(view);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const { collapsed, mobile, toggle } = useSidebarLayout();
  const toggleLabel = collapsed ? '展开侧栏' : '收起侧栏';
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
  const main = useRef<HTMLDivElement>(null);
  const [creativeDirty, setCreativeDirty] = useState(false);
  const [homeRetry, setHomeRetry] = useState(0);
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
    if (!workbench || current) return;
    const request = new AbortController();
    taskRequest.current = request;
    setLoadingTask(true);
    setTaskError(false);
    async function loadInitialTask() {
      const stored = readTaskPreference(session);
      if (stored) {
        try {
          return await getTask(stored, request.signal);
        } catch (cause) {
          if (!(cause instanceof ApiError) || ![403, 404].includes(cause.status)) throw cause;
        }
      }
      const { items } = await listTasks('', null, request.signal);
      return items[0] ? getTask(items[0].id, request.signal) : undefined;
    }
    void loadInitialTask()
      .then((task) => {
        if (request.signal.aborted || !task) return;
        setCurrent(task);
        rememberTask(session, task.id);
      })
      .catch(() => {
        if (!request.signal.aborted) setTaskError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoadingTask(false);
      });
    return () => request.abort();
  }, [workbench, current, homeRetry, session]);
  useEffect(() => {
    if (!navigationOpen) return;
    if (!mobile) {
      setNavigationOpen(false);
      return;
    }
    navigationClose.current?.focus();
    const content = main.current;
    const trigger = navigationTrigger.current;
    const bar = trigger?.parentElement;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (content) content.inert = true;
    if (bar) bar.inert = true;
    return () => {
      document.body.style.overflow = priorOverflow;
      if (content) content.inert = false;
      if (bar) bar.inert = false;
      trigger?.focus();
    };
  }, [navigationOpen, mobile]);

  function closeNavigation() {
    setNavigationOpen(false);
  }

  function canLeave() {
    return !creativeDirty || window.confirm('当前创作草稿有未保存的编辑或正在处理。确定离开？');
  }

  function navigate(next: View) {
    if (view === next) {
      setNavigationOpen(false);
      return;
    }
    if (view !== next && !canLeave()) return;
    const nextEntry = isCreationEntry(next);
    if (!workbench || !nextEntry || current) {
      taskRequest.current?.abort();
      setLoadingTask(false);
      setTaskError(false);
    }
    if (nextEntry) {
      setEntry(next);
      rememberEntry(session, next);
    }
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
          rememberTask(session, task.id);
          setView(entry);
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
    <section className="workspace" data-sidebar-collapsed={collapsed}>
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
        role={mobile && navigationOpen ? 'dialog' : undefined}
        aria-modal={mobile && navigationOpen ? true : undefined}
        aria-label={mobile && navigationOpen ? '工作区导航' : undefined}
        onKeyDown={(event) => {
          if (navigationOpen && event.key === 'Escape') closeNavigation();
        }}
      >
        <div className="work-brand">
          <img className="work-brand-mark" src={studioMark} alt="" width="32" height="32" />
          <div className="work-brand-name">
            <strong>造物</strong>
            <small>STUDIO</small>
          </div>
          <button
            type="button"
            className="work-sidebar-toggle"
            title={toggleLabel}
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls="work-sidebar"
            onClick={toggle}
          >
            <span className="work-sidebar-glyph" aria-hidden="true" />
          </button>
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
          <small className="studio-nav-label">WORKSPACE</small>
          <div className="work-creation-nav" role="group" aria-label="创作工作台">
            <span className="work-creation-label">创作工作台</span>
            {(
              [
                { id: 'quick', label: '快捷生成', Icon: ThunderboltOutlined },
                { id: 'canvas', label: '画布', Icon: ApartmentOutlined },
              ] as const
            )
              .filter(({ id }) => id !== 'canvas' || session.permissions.includes('view'))
              .map(({ id, label, Icon }) => (
                <Tooltip key={id} title={collapsed ? label : null} placement="right">
                  <button
                    type="button"
                    aria-label={label}
                    aria-current={view === id ? 'page' : undefined}
                    onClick={() => navigate(id)}
                  >
                    <Icon aria-hidden="true" />
                    <span className="work-nav-label">{label}</span>
                  </button>
                </Tooltip>
              ))}
            <Tooltip
              title={!canCreate ? '需要创作权限' : collapsed ? '批量制作' : null}
              placement="right"
            >
              <button
                type="button"
                aria-label="批量制作"
                disabled={!canCreate}
                aria-current={view === 'batch' ? 'page' : undefined}
                onClick={() => navigate('batch')}
              >
                <AppstoreOutlined aria-hidden="true" />
                <span className="work-nav-label">批量制作</span>
              </button>
            </Tooltip>
          </div>
          {navigation
            .filter((item) => item.view !== 'templates' || canManage)
            .map(({ view: destination, label, Icon }) => (
              <Tooltip
                key={destination}
                title={collapsed ? label : null}
                placement="right"
                trigger={['hover', 'focus']}
              >
                <button
                  type="button"
                  aria-label={label}
                  aria-current={view === destination ? 'page' : undefined}
                  onClick={() => navigate(destination)}
                >
                  <Icon aria-hidden="true" />
                  <span className="work-nav-label">{label}</span>
                </button>
              </Tooltip>
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
            aria-label="退出登录"
            title="退出登录"
            onClick={() => {
              if (canLeave()) onLogout();
            }}
            disabled={busy}
          >
            {collapsed && <LogoutOutlined aria-hidden="true" />}
            <span className="work-nav-label">退出登录</span>
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
      <div ref={main} className="work-main">
        {(!workbench || !current) && (
          <div className="work-row work-title">
            <h2>
              {workbench
                ? view === 'canvas'
                  ? '画布'
                  : view === 'batch'
                    ? '批量制作'
                    : '创作工作台'
                : view === 'tasks'
                  ? '全部任务'
                  : view === 'products'
                    ? '商品资料'
                    : view === 'cases'
                      ? '案例库'
                      : '公司模板'}
            </h2>
            {canCreate && (workbench || view === 'tasks') && (
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
            {workbench && <button onClick={() => setHomeRetry((n) => n + 1)}>重新加载任务</button>}
          </p>
        )}
        {workbench && !current && !loadingTask && !taskError && (
          <>
            <p className="work-muted">
              {canCreate ? '新建制作，选择商品后开始第一份创作。' : '暂无可查看的任务。'}
            </p>
            {view === 'quick' && <StudioResults results={[]} />}
          </>
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
        {workbench && current && (
          <TaskStudio
            key={`${current.id}:${view}`}
            entry={view}
            task={current}
            categories={categories}
            session={session}
            onDirty={setCreativeDirty}
            onBack={() => navigate(view === 'canvas' ? 'quick' : 'tasks')}
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
              taskRequest.current?.abort();
              setLoadingTask(false);
              setTaskError(false);
              setView(entry);
              setCurrent(task);
              rememberTask(session, task.id);
              setSetup(undefined);
            }}
          />
        )}
      </div>
    </section>
  );
}

function isCreationEntry(view: View): view is CreationEntry {
  return view === 'quick' || view === 'canvas' || view === 'batch';
}
