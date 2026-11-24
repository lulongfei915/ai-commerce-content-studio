import { useCallback, useState } from 'react';
import { LockOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { ReferenceTarget } from '../creation/ReferenceTarget';
import type { Task } from '../tasks/api';
import type { Category } from '../products/api';
import { casePreview, listCases, type CreativeCase } from './api';
import { examples } from './examples';

type Card = {
  name: string;
  features: string;
  category: string;
  media: string;
  url: string;
  item?: CreativeCase;
};

export function InspirationGallery({
  categories,
  token,
  current,
  canCreate,
  canPlayVideo,
  revision,
  onEdit,
}: {
  categories: Category[];
  token: string;
  current?: Task;
  canCreate: boolean;
  canPlayVideo: boolean;
  revision: number;
  onEdit?: (item: CreativeCase) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [media, setMedia] = useState('');
  const [preview, setPreview] = useState<Card>();
  const [reference, setReference] = useState<CreativeCase>();
  const [message, setMessage] = useState('');
  const load = useCallback(
    (q: string, cursor: string | null, signal: AbortSignal) =>
      listCases(q, cursor, signal, category, media),
    [category, media],
  );
  const page = useSearchPage(load, revision);
  const cards: Card[] = page.items.map((item) => ({
    ...item,
    features: item.source,
    url: casePreview(item.id),
    item,
  }));
  if (!page.hasPrevious)
    cards.push(
      ...examples
        .filter(
          (e) =>
            (!category || e.category === category) &&
            (!media || e.media === media) &&
            `${e.name} ${e.features}`.includes(query.trim()),
        )
        .map((e) => ({ ...e, url: e.image })),
    );
  const mediaView = (c: Card, detail = false) =>
    c.item && c.media === 'video' ? (
      canPlayVideo ? (
        <video aria-label={c.name} src={c.url} controls={detail} preload="none" />
      ) : (
        <span>视频预览需原件授权</span>
      )
    ) : (
      <img src={c.url} alt={c.name} loading="lazy" />
    );
  return (
    <section aria-label="案例列表" className="resource-section">
      <div className="resource-toolbar">
        <label className="resource-search">
          <SearchOutlined />
          <input
            type="search"
            aria-label="搜索案例"
            placeholder="搜索案例名称、场景或风格"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              page.search(e.target.value);
            }}
          />
        </label>
        <div className="resource-segments" role="group" aria-label="案例媒体">
          {Object.entries({ '': '全部', image: '图片', video: '视频' }).map(([id, label]) => (
            <button
              key={id}
              aria-pressed={media === id}
              onClick={() => {
                setMedia(id);
                page.reload();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          aria-label="筛选案例品类"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            page.reload();
          }}
        >
          <option value="">全部品类</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <small className="resource-count">
          {page.next || page.hasPrevious ? '本页 ' : ''}
          {cards.length} 个案例
        </small>
      </div>
      {message && <p role="status">{message}</p>}
      {page.error && (
        <p role="alert">
          公司案例未加载。 <button onClick={page.reload}>重试</button>
        </p>
      )}
      {page.loading && <p role="status">正在加载公司案例…</p>}
      {!cards.length && !page.loading && !page.error && (
        <p className="resource-empty">暂无符合条件的案例。</p>
      )}
      <div className="resource-gallery">
        {cards.map((c) => (
          <article className="resource-card" key={c.item?.id ?? `sample-${c.name}`}>
            <button
              className="resource-art"
              aria-label={`预览${c.name}`}
              onClick={() => setPreview(c)}
            >
              {mediaView(c)}
            </button>
            <div className="resource-copy">
              <h3>{c.name}</h3>
              <p>{c.features}</p>
              <footer>
                <small>
                  {categories.find((x) => x.id === c.category)?.label ?? c.category} ·{' '}
                  {c.item ? '公司案例' : c.media === 'video' ? '示例分镜' : '示例'}
                </small>
                {c.item ? (
                  <button
                    disabled={!c.item.usage_scope || !canCreate || !current}
                    onClick={() => setReference(c.item)}
                  >
                    {c.item.usage_scope ? (
                      <>
                        <PlusOutlined aria-hidden="true" /> 添加参考
                      </>
                    ) : (
                      <>
                        <LockOutlined aria-hidden="true" /> 暂不可引用
                      </>
                    )}
                  </button>
                ) : (
                  <button onClick={() => setPreview(c)}>查看构图</button>
                )}
              </footer>
            </div>
          </article>
        ))}
      </div>
      <div className="work-actions">
        {page.hasPrevious && <button onClick={page.first}>回到首页</button>}
        {page.next && <button onClick={page.more}>下一页</button>}
      </div>
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(undefined)}>
          <div className="resource-preview">
            {mediaView(preview, true)}
            <p>{preview.features}</p>
            <p>
              {preview.item?.usage_scope ??
                (preview.item ? '仅浏览 · 授权待确认' : '构图示例 · 仅供浏览')}
            </p>
            {preview.item && onEdit && (
              <button
                onClick={() => {
                  onEdit(preview.item!);
                  setPreview(undefined);
                }}
              >
                编辑授权
              </button>
            )}
          </div>
        </Modal>
      )}
      {reference && current && (
        <ReferenceTarget
          source={reference}
          task={current}
          token={token}
          onClose={() => setReference(undefined)}
          onSaved={() => {
            setReference(undefined);
            setMessage('已添加至目标草稿');
          }}
        />
      )}
    </section>
  );
}
