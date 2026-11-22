import { SearchBar } from '../../shared/ui/SearchBar';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { listProducts } from './api';
import type { Product } from './api';

type Props = {
  selected: Product[];
  onChange: (products: Product[]) => void;
  excluded?: string[];
  revision?: number;
};

export function ProductPicker({ selected, onChange, excluded = [], revision }: Props) {
  const page = useSearchPage(listProducts, revision);
  const visible = [
    ...selected,
    ...page.items.filter(
      (product) =>
        !excluded.includes(product.id) && !selected.some((item) => item.id === product.id),
    ),
  ];
  return (
    <div className="work-form">
      <SearchBar label="搜索商品或 SKU" onSearch={page.search} />
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
      <div className="work-options">
        {visible.map((product) => {
          const checked = selected.some((item) => item.id === product.id);
          return (
            <label className="work-check product-option" key={product.id}>
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
              <span>
                {product.name} <small>{product.sku}</small>
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
