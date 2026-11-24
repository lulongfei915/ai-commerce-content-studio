import { SearchBar } from '../../shared/ui/SearchBar';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { listTasks } from './api';

export function TaskList({
  onOpen,
  action = '继续创作',
}: {
  onOpen: (id: string) => void;
  action?: string;
}) {
  const page = useSearchPage(listTasks);
  return (
    <section className="work-form" aria-label="全部任务">
      <SearchBar label="搜索任务、商品或 SKU" onSearch={page.search} />
      {page.loading && <p role="status">正在加载任务…</p>}
      {page.error && (
        <p role="alert" className="work-error">
          任务未加载。{' '}
          <button type="button" onClick={page.reload}>
            重试
          </button>
        </p>
      )}
      {!page.loading && !page.error && !page.items.length && (
        <p className="work-muted">暂无符合条件的任务。</p>
      )}
      {page.items.map((task) => (
        <article key={task.id} className="work-card work-row">
          <div>
            <h3>{task.name}</h3>
            <p className="work-muted">{task.status === 'draft' ? '草稿' : task.status}</p>
          </div>
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            aria-label={`${action}：${task.name}`}
          >
            {action}
          </button>
        </article>
      ))}
      <div className="work-actions">
        {page.hasPrevious && (
          <button type="button" disabled={page.loading} onClick={page.first}>
            回到首页
          </button>
        )}
        {page.next && (
          <button type="button" disabled={page.loading} onClick={page.more}>
            下一页
          </button>
        )}
      </div>
    </section>
  );
}
