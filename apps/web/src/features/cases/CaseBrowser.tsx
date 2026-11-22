import { useCallback, useState } from 'react';

import { SearchBar } from '../../shared/ui/SearchBar';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import type { Category } from '../products/api';
import { casePreview, listCases } from './api';
import type { CreativeCase, UsagePurpose } from './api';

type Props = {
  categories: Category[];
  category?: string;
  purpose?: UsagePurpose;
  imageOnly?: boolean;
  revision?: number;
  selected?: string[];
  canPlayVideo?: boolean;
  disabled?: boolean;
  onPick?: (item: CreativeCase) => void;
  onEdit?: (item: CreativeCase) => void;
};

export function CaseBrowser({
  categories,
  category,
  purpose,
  imageOnly,
  revision,
  selected,
  canPlayVideo,
  disabled,
  onPick,
  onEdit,
}: Props) {
  const [filter, setFilter] = useState('');
  const [media, setMedia] = useState('');
  const load = useCallback(
    (query: string, cursor: string | null, signal: AbortSignal) =>
      listCases(query, cursor, signal, category ?? filter, imageOnly ? 'image' : media),
    [category, filter, imageOnly, media],
  );
  const page = useSearchPage(load, revision);
  return (
    <section className="work-form" aria-label="案例列表">
      <div className="work-row">
        <SearchBar label="搜索案例名称或来源" onSearch={page.search} />
        {!category && (
          <label>
            品类{' '}
            <select
              aria-label="筛选案例品类"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                page.reload();
              }}
            >
              <option value="">全部品类</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {!imageOnly && (
          <label>
            媒体{' '}
            <select
              aria-label="筛选案例媒体"
              value={media}
              onChange={(event) => {
                setMedia(event.target.value);
                page.reload();
              }}
            >
              <option value="">全部媒体</option>
              <option value="image">图片</option>
              <option value="video">视频</option>
            </select>
          </label>
        )}
      </div>
      {page.loading && <p role="status">正在加载案例…</p>}
      {page.error && (
        <p role="alert" className="work-error">
          案例未加载。{' '}
          <button type="button" onClick={page.reload}>
            重试
          </button>
        </p>
      )}
      {!page.loading && !page.error && !page.items.length && (
        <p className="work-muted">暂无符合条件的案例。</p>
      )}
      <div className="work-cards">
        {page.items.map((item) => (
          <article className="work-card creative-case" key={item.id}>
            {item.media === 'image' ? (
              <img loading="lazy" alt={`${item.name}预览`} src={casePreview(item.id)} />
            ) : canPlayVideo ? (
              <video
                aria-label={`${item.name}预览`}
                controls
                preload="none"
                src={casePreview(item.id)}
              />
            ) : (
              <p className="work-muted">播放视频需原件授权</p>
            )}
            <h3>{item.name}</h3>
            <p className="work-muted">
              {categories.find((entry) => entry.id === item.category)?.label ?? item.category} ·
              文件 V{item.file_version}
            </p>
            <p>来源 · {item.source}</p>
            <p className="work-muted">{item.usage_scope || '仅浏览 · 使用范围未确认'}</p>
            <div className="work-actions">
              {onEdit && (
                <button type="button" onClick={() => onEdit(item)}>
                  编辑授权
                </button>
              )}
              {onPick && (
                <button
                  type="button"
                  disabled={
                    !selected?.includes(item.id) &&
                    (disabled ||
                      !item.usage_scope ||
                      (purpose !== undefined && !item.usage_purposes?.includes(purpose)) ||
                      item.media !== 'image' ||
                      (selected?.length ?? 0) >= 10)
                  }
                  onClick={() => onPick(item)}
                >
                  {selected?.includes(item.id) ? '移除案例' : '添加为参考'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
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
