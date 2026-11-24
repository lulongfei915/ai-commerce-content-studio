import { useState } from 'react';
import { PictureOutlined, SearchOutlined } from '@ant-design/icons';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { listProducts } from './api';
import type { Category, Product } from './api';
import { photoPreviewUrl } from './preview';

type Props = {
  categories: Category[];
  initialId?: string;
  selected: Product[];
  onChange: (products: Product[]) => void;
  excluded?: string[];
  revision?: number;
};

export function ProductPicker({
  categories,
  initialId,
  selected,
  onChange,
  excluded = [],
  revision,
}: Props) {
  const page = useSearchPage(listProducts, revision);
  const [query, setQuery] = useState('');
  const term = query.trim().toLowerCase();
  const matches = [
    ...selected.filter(
      (product) =>
        !page.items.some((item) => item.id === product.id) &&
        `${product.name} ${product.sku}`.toLowerCase().includes(term),
    ),
    ...page.items.filter((product) => !excluded.includes(product.id)),
  ];
  const initial = matches.find((product) => product.id === initialId);
  const visible = initial ? [initial, ...matches.filter((product) => product !== initial)] : matches;
  return (
    <div className="task-product-picker">
      <div className="task-product-search">
        <SearchOutlined aria-hidden="true" />
        <input
          type="search"
          aria-label="搜索可选商品"
          placeholder="搜索商品名称或 SKU"
          maxLength={100}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            page.search(event.target.value);
          }}
        />
      </div>
      {page.error && (
        <p role="alert" className="work-error">
          商品未加载。{' '}
          <button type="button" onClick={page.reload}>
            重试
          </button>
        </p>
      )}
      {page.loading && <p role="status">正在加载商品…</p>}
      {!page.loading && !page.error && visible.length === 0 && (
        <p className="work-muted">没有符合条件的可选商品。</p>
      )}
      <div className="task-product-options" role="group" aria-label="可选商品">
        {visible.map((product) => {
          const checked = selected.some((item) => item.id === product.id);
          const category = categories.find(({ id }) => id === product.category);
          const photo = product.photos[0];
          return (
            <label className="task-product-option" key={product.id}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && selected.length >= 50}
                onChange={() =>
                  onChange(
                    checked
                      ? selected.filter((item) => item.id !== product.id)
                      : [...selected, product],
                  )
                }
              />
              <span className="task-product-thumb">
                {photo ? (
                  <img src={photoPreviewUrl(product.id, photo.file_id)} alt="" loading="lazy" />
                ) : (
                  <PictureOutlined aria-hidden="true" />
                )}
              </span>
              <span className="task-product-identity">
                <strong>{product.name}</strong>
                <small>
                  {product.sku} · {category?.label ?? product.category}
                </small>
              </span>
            </label>
          );
        })}
      </div>
      {(page.hasPrevious || page.next) && (
        <div className="work-actions">
          {page.hasPrevious && (
            <button type="button" onClick={page.first} disabled={page.loading}>
              回到首页
            </button>
          )}
          {page.next && (
            <button type="button" onClick={page.more} disabled={page.loading}>
              下一页
            </button>
          )}
        </div>
      )}
    </div>
  );
}
