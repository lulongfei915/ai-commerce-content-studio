import { useState } from 'react';
import {
  ArrowRightOutlined,
  PictureOutlined,
  PlusOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { SearchBar } from '../../shared/ui/SearchBar';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { listProducts } from './api';
import type { Category, Product } from './api';
import { photoPreviewUrl } from './preview';
import { ProductDetails } from './ProductDetails';
import { specificationText } from './specification';
import './products.css';

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
  const [details, setDetails] = useState<Product>();
  return (
    <section className="products-page" aria-label="商品资料">
      <header className="products-heading">
        <div>
          <h2>商品资料</h2>
          <p>管理商品实拍、规格与已确认信息。</p>
        </div>
        {canCreate && categories.length > 0 && (
          <button type="button" onClick={onCreate}>
            <PlusOutlined aria-hidden="true" /> 添加商品
          </button>
        )}
      </header>
      <div className="products-toolbar">
        <SearchBar label="搜索商品或 SKU" onSearch={page.search} />
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
      <div className="products-grid">
        {page.items.map((product) => {
          const category = categories.find((item) => item.id === product.category);
          const summary = specificationText(product, category).replace(/\s*\n\s*/g, ' · ');
          const confirmed = Boolean(summary && product.photos.length);
          return (
            <article className="product-card" key={product.id}>
              <button
                type="button"
                className="product-cover"
                aria-label={`查看 ${product.name}`}
                onClick={() => setDetails(product)}
              >
                {product.photos[0] ? (
                  <img
                    loading="lazy"
                    src={photoPreviewUrl(product.id, product.photos[0].file_id)}
                    alt="商品实拍"
                  />
                ) : (
                  <span>
                    <PictureOutlined aria-hidden="true" /> 暂无实拍
                  </span>
                )}
              </button>
              <div className="product-card-body">
                <div className="product-card-title">
                  <h3 title={product.name}>{product.name}</h3>
                  <span className="product-status" data-confirmed={confirmed}>
                    {confirmed && <SafetyCertificateOutlined aria-hidden="true" />}
                    {confirmed ? '已确认' : '待完善'}
                  </span>
                </div>
                <div className="product-identity">
                  <span>{product.sku}</span>
                  <span>{category?.label ?? product.category}</span>
                </div>
                <p className="product-card-summary" title={summary}>
                  {summary || '尚未填写规格'}
                </p>
                <div className="product-card-actions">
                  <button
                    type="button"
                    className="product-view"
                    onClick={() => setDetails(product)}
                  >
                    查看资料 <RightOutlined aria-hidden="true" />
                  </button>
                  {canCreate && (
                    <button
                      type="button"
                      className="product-start"
                      onClick={() => onStart(product)}
                    >
                      用此商品制作 <ArrowRightOutlined aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
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
      {details && (
        <ProductDetails
          product={details}
          category={categories.find((item) => item.id === details.category)}
          onClose={() => setDetails(undefined)}
          onEdit={
            canCreate && categories.length
              ? () => {
                  setDetails(undefined);
                  onEdit(details);
                }
              : undefined
          }
          onStart={
            canCreate
              ? () => {
                  setDetails(undefined);
                  onStart(details);
                }
              : undefined
          }
        />
      )}
    </section>
  );
}
