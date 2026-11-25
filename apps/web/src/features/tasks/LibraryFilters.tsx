import { useState } from 'react';
import { CloseOutlined, DownOutlined, FilterOutlined } from '@ant-design/icons';
import { statusLabel } from '../canvas/status';
import type { TaskResult } from '../creation/results';

export const libraryDefaults = { category: '', media: '', scene: '', task: '', status: 'approved' };
type Filters = typeof libraryDefaults;
type Key = keyof Filters;
const titles: Record<Key, string> = {
  category: '品类',
  media: '媒体',
  scene: '场景',
  task: '来源任务',
  status: '审核状态',
};
const labels: Record<string, string> = { ...statusLabel, image: '图片', video: '视频' };

export function matchesFilters(item: TaskResult, filters: Filters) {
  return (
    (!filters.category || item.category_label === filters.category) &&
    (!filters.media || item.media === filters.media) &&
    (!filters.scene || (item.scene || '未记录场景') === filters.scene) &&
    (!filters.task || item.task_id === filters.task) &&
    (!filters.status || item.status === filters.status)
  );
}

export function LibraryFilters({
  items,
  count,
  filters,
  setFilters,
  query,
  setQuery,
}: {
  items: TaskResult[];
  count?: number;
  filters: Filters;
  setFilters: (value: Filters) => void;
  query: string;
  setQuery: (query: string) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const tasks = new Map(items.map((item) => [item.task_id, item.task_name ?? item.task_id]));
  const options = {
    category: [
      ...new Set(items.flatMap((item) => (item.category_label ? [item.category_label] : []))),
    ],
    media: ['image', 'video'],
    scene: [...new Set(items.map((item) => item.scene || '未记录场景'))],
    task: [...tasks.keys()],
    status: ['approved', 'pending_review', 'rejected', 'revoked'],
  };
  const valueLabel = (key: Key, value: string) =>
    (key === 'task' ? tasks.get(value) : labels[value]) || value || '全部状态';
  const set = (key: Key, value: string) => setFilters({ ...filters, [key]: value });
  const active = (Object.keys(filters) as Key[]).filter(
    (key) => Boolean(filters[key]),
  );
  const select = (key: Key) => (
    <select
      key={key}
      aria-label={`素材${titles[key]}`}
      value={filters[key]}
      onChange={(e) => set(key, e.target.value)}
    >
      <option value="">全部{titles[key]}</option>
      {options[key].map((value) => (
        <option key={value} value={value}>
          {valueLabel(key, value)}
        </option>
      ))}
    </select>
  );
  return (
    <>
      {select('category')}
      {select('media')}
      <button
        aria-expanded={advanced}
        aria-controls="library-advanced"
        onClick={() => setAdvanced(!advanced)}
      >
        <FilterOutlined /> 更多筛选 <DownOutlined />
      </button>
      {advanced && (
        <div id="library-advanced" className="resource-toolbar library-filter-row">
          {select('scene')}
          {select('task')}
          {select('status')}
        </div>
      )}
      {count !== undefined && <small className="library-count" role="status">
        找到 {count} 份{filters.status === 'approved' ? '已批准' : ''}素材 <span>· 公司共 {items.length} 份</span>
      </small>}
      {(active.length > 0 || query) && (
        <div className="library-summary">
          <div className="library-chips" aria-label="已生效的筛选">
          {query && (
            <button onClick={() => setQuery('')}>
              关键词 · {query} <CloseOutlined />
            </button>
          )}
          {active.map((key) => (
            <button key={key} onClick={() => set(key, '')}>
              {key === 'status' && filters.status === 'approved' ? '仅已批准' : valueLabel(key, filters[key])} <CloseOutlined />
            </button>
          ))}
          </div>
          <button className="library-reset"
            onClick={() => {
              setFilters(libraryDefaults);
              setQuery('');
            }}
          >
            重置筛选
          </button>
        </div>
      )}
    </>
  );
}
