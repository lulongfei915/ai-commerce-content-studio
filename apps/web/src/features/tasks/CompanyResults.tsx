import { useEffect, useState } from 'react';
import {
  ArrowLeftOutlined,
  ControlOutlined,
  DownOutlined,
  DownloadOutlined,
  QuestionCircleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { ApiError, apiFetch, apiPrefix } from '../../shared/api/client';
import { DeliveryRequirements } from './DeliveryRequirements';
import { Modal } from '../../shared/ui/Modal';
import type { Session } from '../auth/session';
import { statusLabel } from '../canvas/status';
import { resultPreview, type TaskResult } from '../creation/results';
import { actionError, type Draft } from '../creation/api';
import { LibraryReference, LibrarySource } from './LibraryDialogs';
import './library.css';
import { getTask, purposeLabel, type Task } from './api';
import { ReviewDialog } from './ReviewDialog';
import { VersionActions } from './VersionActions';
import { DeliveryChecklist, type Adoption } from './DeliveryChecklist';
import { TaskList } from './TaskList';
import { LibraryFilters, libraryDefaults, matchesFilters } from './LibraryFilters';

function Artwork({ item }: { item: TaskResult }) {
  return item.media === 'image' && item.file_version ? (
    <img
      alt={item.label}
      src={resultPreview(item.task_id, item.version_id, item.file_version, item.version)}
    />
  ) : (
    <span>{item.media === 'video' ? '视频' : '暂无预览'}</span>
  );
}

export function CompanyResults({
  review,
  session,
  current,
  onReturn,
  onTasks,
  onSelectTask,
  onCreatePosition,
  onTaskChange,
  onReferenced,
}: {
  review: boolean;
  session: Session;
  current?: Task;
  onReturn: () => void;
  onTasks?: () => void;
  onSelectTask?: (id: string) => void;
  onCreatePosition?: (id: string) => void;
  onTaskChange?: (task: Task) => void;
  onReferenced?: (draft: Draft) => void;
}) {
  const [library, setLibrary] = useState(false);
  const [libraryHelp, setLibraryHelp] = useState(false);
  const delivery = !review && !library;
  const [allTasks, setAllTasks] = useState(!current);
  const [status, setStatus] = useState(review ? 'pending_review' : 'approved');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(libraryDefaults);
  const [taskPicker, setTaskPicker] = useState(false);
  const [requirements, setRequirements] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [items, setItems] = useState<TaskResult[]>([]);
  const [adoptions, setAdoptions] = useState<Record<string, Adoption | null>>({});
  const [selected, setSelected] = useState<TaskResult>();
  const [positionId, setPositionId] = useState<string>();
  const [sourceTask, setSourceTask] = useState<Task>();
  const [detailError, setDetailError] = useState('');
  const [reference, setReference] = useState<TaskResult>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    const params = new URLSearchParams({ status: '' });
    if ((delivery || (review && !allTasks)) && current) params.set('task_id', current.id);
    setLoading(true);
    setError('');
    setItems([]);
    setAdoptions({});
    void Promise.all([
      delivery && !current
        ? Promise.resolve([])
        : apiFetch<TaskResult[]>(`${review ? '/reviews' : '/assets'}?${params}`, {
            signal: ctl.signal,
          }),
      Promise.all(
        (delivery ? (current?.positions ?? []) : []).map(async (p) => {
          const item = await apiFetch<Adoption | null>(`/delivery-positions/${p.id}/adoption`, {
            signal: ctl.signal,
          });
          return [p.id, item] as const;
        }),
      ),
    ])
      .then(async ([rows, positions]) => {
        if (ctl.signal.aborted) return;
        const known = new Set(rows.map((item) => item.version_id));
        // A position may adopt an approved version originating from another task.
        const external = await Promise.all(
          positions.flatMap(([, adoption]) =>
            adoption && !known.has(adoption.version_id)
              ? [
                  apiFetch<TaskResult>(`/assets/${encodeURIComponent(adoption.version_id)}`, {
                    signal: ctl.signal,
                  }).catch((cause: unknown) => {
                    if (cause instanceof ApiError && cause.status === 404) return null;
                    throw cause;
                  }),
                ]
              : [],
          ),
        );
        if (!ctl.signal.aborted) {
          setItems([...rows, ...external.filter((item) => item !== null)]);
          setAdoptions(Object.fromEntries(positions));
        }
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [delivery, review, current, allTasks, revision]);
  useEffect(() => {
    if (!selected || library) return;
    const ctl = new AbortController();
    setDetailError('');
    setSourceTask(undefined);
    void getTask(selected.task_id, ctl.signal)
      .then((t) => {
        if (!ctl.signal.aborted) setSourceTask(t);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setDetailError(actionError(e));
      });
    return () => ctl.abort();
  }, [selected, library]);
  const rows = items.filter(
    (item) =>
      (review ? !status || item.status === status : matchesFilters(item, filters)) &&
      `${item.label} ${item.sku} ${item.task_name ?? ''} ${item.task_id} ${item.product_id}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const filled = Object.values(adoptions).filter(
    (a) =>
      a &&
      items.some((i) => i.version_id === a.version_id && i.status === 'approved' && i.previewable),
  ).length;
  const canConfigure = !!onTaskChange && session.permissions.includes('create');
  return (
    <section className={`resource-section${review ? '' : ' delivery-page'}`}>
      <header className={`resource-heading${library ? ' library-heading' : ''}`}>
        <div>
          <h2>{review ? '审核中心' : '资产与交付'}</h2>
          {review ? (
            <p>核对商品一致性，完成素材审核。</p>
          ) : library ? (
            <span className="library-scope">公司范围</span>
          ) : (
            <div className="delivery-context" aria-label="交付任务">
              {onTasks && (
                <button onClick={onTasks}>
                  <ArrowLeftOutlined aria-hidden="true" /> 全部任务
                </button>
              )}
              {onTasks && <span aria-hidden="true">/</span>}
              {onSelectTask ? (
                <button onClick={() => setTaskPicker(true)}>
                  <span>{current?.name ?? '选择任务'}</span> <DownOutlined aria-hidden="true" />
                </button>
              ) : (
                current && <span>{current.name}</span>
              )}
            </div>
          )}
        </div>
        {library && <div className="library-heading-actions">
          {current && <button title="返回创作" aria-label="返回创作" onClick={onReturn}><ArrowLeftOutlined /></button>}
          <button title="公司素材使用说明" aria-label="公司素材使用说明" onClick={() => setLibraryHelp(true)}><QuestionCircleOutlined /></button>
        </div>}
        {current && !library && (
          <button onClick={onReturn}>{review || library ? '返回创作' : '返回此任务创作'}</button>
        )}
      </header>
      {!review && (
        <div className="delivery-toolbar">
          <div className="resource-segments" role="group" aria-label="资产与交付视图">
            {['本次交付', '公司素材'].map((label, i) => (
              <button
                key={label}
                aria-pressed={library === !!i}
                onClick={() => {
                  setLibrary(!!i);
                  setMessage('');
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {library && <small className="library-team">跨任务浏览 · {session.tenant.name}</small>}
          {delivery && current && (
            <div className="delivery-toolbar-actions">
              <button onClick={() => setRequirements(true)}>
                <ControlOutlined aria-hidden="true" />{' '}
                {canConfigure ? '配置交付要求' : '查看交付要求'}
              </button>
              <span>
                <button
                  className="work-primary"
                  disabled={!filled || loading || !session.permissions.includes('download')}
                  onClick={() => setExporting(true)}
                >
                  <DownloadOutlined aria-hidden="true" />{' '}
                  {filled
                    ? filled === current.positions.length
                      ? '导出完整交付包'
                      : '导出部分交付包'
                    : '导出交付包'}
                </button>
              </span>
            </div>
          )}
        </div>
      )}
      {!delivery && (
        <div className={`resource-toolbar${library ? ' library-controls' : ''}`}>
          {review && (
            <div className="resource-segments" role="group" aria-label="审核状态">
              {['pending_review', 'rejected', 'approved', 'revoked', ''].map((s) => (
                <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                  {statusLabel[s] ?? '全部'}{' '}
                  <small>{s ? items.filter((i) => i.status === s).length : items.length}</small>
                </button>
              ))}
            </div>
          )}
          {review && current && (
            <select
              aria-label="任务范围"
              value={allTasks ? 'all' : 'current'}
              onChange={(e) => setAllTasks(e.target.value === 'all')}
            >
              <option value="current">{current.name}</option>
              <option value="all">全部任务</option>
            </select>
          )}
          <label className="resource-search">
            <SearchOutlined />
            <input
              type="search"
              aria-label="搜索资产"
              placeholder="搜索素材、SKU 或来源任务"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {!review && (
            <LibraryFilters
              items={items}
              count={loading || error ? undefined : rows.length}
              filters={filters}
              setFilters={setFilters}
              query={query}
              setQuery={setQuery}
            />
          )}
        </div>
      )}
      {error && (
        <p role="alert">
          {error} <button onClick={() => setRevision((n) => n + 1)}>重试</button>
        </p>
      )}
      {loading && <p role="status">正在加载…</p>}
      {message && <p role="status">{message}</p>}
      {!error &&
        !loading &&
        (delivery ? (
          <DeliveryChecklist
            key={current?.id}
            task={current}
            items={items}
            adoptions={adoptions}
            canAdopt={session.permissions.includes('adopt')}
            canDownload={session.permissions.includes('download')}
            token={session.csrf_token}
            onOpen={(asset, id) => {
              setPositionId(id);
              setSelected(asset);
            }}
            onCreate={session.permissions.includes('create') ? onCreatePosition : undefined}
            onRefresh={() => setRevision((n) => n + 1)}
          />
        ) : review ? (
          <div className="resource-review">
            <div className="resource-review-row resource-review-head">
              <span>素材 / 商品</span>
              <span>当前状态</span>
              <span>版本</span>
              <span>操作</span>
            </div>
            {rows.map((i) => (
              <article className="resource-review-row" key={i.version_id}>
                <div className="resource-review-item">
                  <button onClick={() => setSelected(i)} aria-label={`预览${i.label}`}>
                    <Artwork item={i} />
                  </button>
                  <div>
                    <h3>{i.label}</h3>
                    <small>{i.sku}</small>
                  </div>
                </div>
                <span>{statusLabel[i.status] ?? i.status}</span>
                <small>V{i.version}</small>
                <button onClick={() => setSelected(i)}>
                  {i.status === 'pending_review' && session.permissions.includes('review')
                    ? '开始审核'
                    : i.status === 'rejected'
                      ? '查看问题'
                      : '查看详情'}
                </button>
              </article>
            ))}
            {!rows.length && <p className="resource-empty">当前没有符合条件的素材</p>}
          </div>
        ) : (
          <>
            <div className="resource-gallery library-gallery">
              {rows.map((i) => (
                <article className="resource-card" key={i.version_id}>
                  <button className="resource-art" aria-label={`查看${i.label}的来源与版本`} onClick={() => setSelected(i)}>
                    <Artwork item={i} />
                  </button>
                  <div className="resource-copy">
                    <div className="library-meta"><small>V{i.version} · {i.media === 'video' ? '视频' : '图片'}</small><span>{statusLabel[i.status] ?? i.status}</span></div>
                    <h3>{i.label}</h3>
                    <p>
                      {i.sku} · {i.scene || '未记录场景'}
                    </p>
                    <small>来源：{i.task_name ?? i.task_id}</small>
                    <footer>
                      <button onClick={() => setSelected(i)}>来源与版本</button>
                      <button
                        disabled={
                          !current || !session.permissions.includes('create') || !i.referenceable
                        }
                        onClick={() => setReference(i)}
                      >
                        引用至制作
                      </button>
                    </footer>
                  </div>
                </article>
              ))}
            </div>
            {!rows.length && <p className="resource-empty">没有符合条件的公司素材</p>}
          </>
        ))}
      {selected && (review || (delivery && selected.status === 'pending_review')) && (
        <ReviewDialog
          key={selected.version_id}
          item={selected}
          task={sourceTask?.id === selected.task_id ? sourceTask : undefined}
          session={session}
          error={detailError}
          onClose={() => setSelected(undefined)}
          onApproved={() => {
            setSelected((open) => (open === selected ? undefined : open));
            setMessage('已批准');
          }}
          refresh={() => setRevision((n) => n + 1)}
        />
      )}
      {library && selected && <LibrarySource key={selected.version_id} item={selected}
        canUse={!!current && session.permissions.includes('create')} canPlay={session.permissions.includes('download')}
        close={() => setSelected(undefined)} reference={() => { setReference(selected); setSelected(undefined); }} />}
      {selected && delivery && selected.status !== 'pending_review' && (
        <Modal
          title={`${selected.sku} · ${selected.label} · V${selected.version}`}
          onClose={() => setSelected(undefined)}
        >
          <div className="resource-preview">
            <Artwork item={selected} />
            {detailError && <p role="alert">{detailError}</p>}
            {sourceTask && (
              <>
                <p>来源任务 · {sourceTask.name}</p>
                <p>
                  {sourceTask.products.find((p) => p.id === selected.product_id)?.name} ·{' '}
                  {selected.sku}
                </p>
                <VersionActions
                  key={selected.version_id}
                  id={selected.version_id}
                  task={delivery && current ? current : sourceTask}
                  positionId={delivery ? positionId : undefined}
                  session={session}
                  refresh={() => setRevision((n) => n + 1)}
                />
              </>
            )}
          </div>
        </Modal>
      )}
      {taskPicker && onSelectTask && (
        <Modal title="切换交付任务" onClose={() => setTaskPicker(false)}>
          <TaskList
            action="查看交付"
            onOpen={(id) => {
              setTaskPicker(false);
              onSelectTask(id);
            }}
          />
        </Modal>
      )}
      {libraryHelp && (
        <Modal title="公司素材使用说明" onClose={() => setLibraryHelp(false)}>
          <p>
            公司素材默认显示已批准版本。选择同 SKU
            的兼容草稿即可引用，来源和版本会随引用保存，新产出单独审核。
          </p>
        </Modal>
      )}
      {exporting && current && (
        <Modal title="核对交付包" onClose={() => setExporting(false)}>
          <p>
            已配齐 {filled}/{current.positions.length}，待补齐 {current.positions.length - filled}
            。包内附版本及缺口清单。
          </p>
          <a
            href={`${apiPrefix}/tasks/${current.id}/delivery-package`}
            download
            onClick={() => setExporting(false)}
          >
            下载交付包
          </a>
        </Modal>
      )}
      {requirements && current && canConfigure && (
        <DeliveryRequirements
          task={current}
          token={session.csrf_token}
          onClose={() => setRequirements(false)}
          onSave={(t) => {
            onTaskChange?.(t);
            setRequirements(false);
            setMessage('交付要求已保存，采用与缺口已重新核对。');
          }}
        />
      )}
      {requirements && current && !canConfigure && (
        <Modal title="当前交付要求" onClose={() => setRequirements(false)}>
          <dl className="delivery-requirements">
            {current.products.map((product) => (
              <div key={product.id}>
                <dt>
                  {product.name} · {product.sku}
                </dt>
                <dd>
                  {current.positions
                    .filter((p) => p.product_id === product.id)
                    .map((p) => purposeLabel[p.purpose])
                    .join('、') || '暂无交付位置'}
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
      {reference && current && (
        <LibraryReference
          key={`${current.id}:${reference.version_id}`}
          task={current}
          item={reference}
          token={session.csrf_token}
          close={() => setReference(undefined)}
          saved={(draft, updatedTask) => {
            if (updatedTask) onTaskChange?.(updatedTask);
            setReference(undefined);
            setMessage('已引用批准版本，保留来源与版本。');
            onReferenced?.(draft);
          }}
        />
      )}
    </section>
  );
}
