import { SearchBar } from '../../shared/ui/SearchBar';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { listProducts } from './api';
import type { Category, Product } from './api';
import { photoPreviewUrl } from './preview';

type Props = {
  categories: Category[];
  canCreate: boolean;
  revision: number;
  onCreate: () => void;
  onEdit: (product: Product) => void;
  onStart: (product: Product) => void;
};

export function ProductCatalog({
  categories,
  canCreate,
  revision,
  onCreate,
  onEdit,
  onStart,
}: Props) {
  const page = useSearchPage(listProducts, revision);
  return (
    <section className="work-form" aria-label="商品资料">
      <div className="work-row">
        <SearchBar label="搜索商品或 SKU" onSearch={page.search} />
        {canCreate && categories.length > 0 && (
          <button type="button" className="work-primary" onClick={onCreate}>
            添加新商品
          </button>
        )}
      </div>
      {page.loading && <p role="status">正在加载商品…</p>}
      {page.error && (
        <p role="alert" className="work-error">
          商品未加载。{' '}
          <button type="button" onClick={page.reload}>
            重试
          </button>
        </p>
      )}
      {!page.loading && !page.error && !page.items.length && (
        <p className="work-muted">暂无符合条件的商品。</p>
      )}
      <div className="work-cards">
        {page.items.map((product) => {
          const category = categories.find((item) => item.id === product.category);
          return (
            <article className="work-card" key={product.id}>
              <div className="work-row product-heading">
                {product.photos[0] && (
                  <img
                    loading="lazy"
                    src={photoPreviewUrl(product.id, product.photos[0].file_id)}
                    alt="商品实拍"
                  />
                )}
                <div>
                  <h3>{product.name}</h3>
                  <p className="work-muted">
                    {product.sku} · {category?.label ?? product.category}
                  </p>
                </div>
              </div>
              <p className="work-muted">
                事实第 {product.fact_version} 版 · {product.photos.length} 张实拍
              </p>
              <details>
                <summary>已确认事实</summary>
                {!Object.keys(product.facts).length && <p className="work-muted">尚未录入事实。</p>}
                <dl>
                  {Object.entries(product.facts).map(([key, fact]) => (
                    <div key={key}>
                      <dt>{category?.fields.find((field) => field.key === key)?.label ?? key}</dt>
                      <dd>
                        {fact.value} <small>依据：{fact.evidence}</small>
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              {canCreate && (
                <div className="work-actions">
                  <button
                    type="button"
                    onClick={() => onEdit(product)}
                    disabled={!categories.length}
                  >
                    编辑资料
                  </button>
                  <button type="button" onClick={() => onStart(product)}>
                    用此商品制作
                  </button>
                </div>
              )}
            </article>
          );
        })}
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
