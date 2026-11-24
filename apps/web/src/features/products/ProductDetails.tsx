import {
  ArrowRightOutlined,
  EditOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import type { Category, Product } from './api';
import { photoPreviewUrl } from './preview';
import { factLabel, specificationKey } from './specification';

type Props = {
  product: Product;
  category?: Category;
  onClose: () => void;
  onEdit?: () => void;
  onStart?: () => void;
};

export function ProductDetails({ product, category, onClose, onEdit, onStart }: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const facts = Object.entries(product.facts);
  const photo = product.photos[photoIndex];
  const colorKey = product.category === 'beauty' ? 'shade' : 'color';
  const color = product.facts[colorKey]?.value;
  const specs = facts.filter(([key]) => key !== colorKey);
  const specText = specs
    .map(([key, fact]) =>
      key === specificationKey ? fact.value : `${factLabel(key, category)}：${fact.value}`,
    )
    .join(' · ');
  const confirmed = Boolean(product.photos.length && facts.length);
  const tags = [color, ...specs.map(([, fact]) => fact.value)].filter(Boolean).slice(0, 3);
  const evidence = new Map<string, string[]>();
  for (const [key, fact] of facts) {
    const label = key === colorKey ? '商品颜色' : factLabel(key, category);
    const labels = evidence.get(fact.evidence) ?? [];
    evidence.set(fact.evidence, [...labels, label]);
  }

  return (
    <Modal title="商品资料" onClose={onClose}>
      <div className="product-details">
        <div className="product-dialog-body">
          <div className="product-detail-overview">
            <div>
              <div className="product-detail-cover">
                {photo ? (
                  <img
                    src={photoPreviewUrl(product.id, photo.file_id)}
                    alt={`${product.name}实拍 ${photoIndex + 1}`}
                  />
                ) : (
                  <span>
                    <PictureOutlined aria-hidden="true" /> 暂无实拍
                  </span>
                )}
              </div>
              {product.photos.length > 1 && (
                <div className="product-detail-thumbnails" role="group" aria-label="商品实拍">
                  {product.photos.map(({ file_id }, index) => (
                    <button
                      key={file_id}
                      type="button"
                      aria-label={`查看实拍 ${index + 1}`}
                      aria-pressed={index === photoIndex}
                      onClick={() => setPhotoIndex(index)}
                    >
                      <img src={photoPreviewUrl(product.id, file_id)} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="product-detail-header">
              <div className="product-detail-title">
                <h3>{product.name}</h3>
                {onEdit && (
                  <button type="button" aria-label="编辑资料" title="编辑资料" onClick={onEdit}>
                    <EditOutlined aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="work-muted">{product.sku}</p>
              {tags.length > 0 && (
                <ul className="product-detail-tags" aria-label="商品特征">
                  {tags.map((tag, index) => (
                    <li key={index} title={tag}>
                      {tag}
                    </li>
                  ))}
                </ul>
              )}
              <span className="product-status" data-confirmed={confirmed}>
                {confirmed && <SafetyCertificateOutlined aria-hidden="true" />}
                {confirmed ? '商品事实已确认' : '商品资料待完善'}
              </span>
            </div>
          </div>
          <dl className="product-detail-facts">
            <dt>所属品类</dt>
            <dd>{category?.label ?? product.category}</dd>
            {color && (
              <>
                <dt>商品颜色</dt>
                <dd>{color}</dd>
              </>
            )}
            <dt>确认规格</dt>
            <dd>{specText || '尚未填写规格'}</dd>
            {evidence.size > 0 && (
              <>
                <dt>确认依据</dt>
                <dd>
                  {[...evidence].map(([source, labels]) => (
                    <div key={source}>
                      {evidence.size > 1 ? `${labels.join('、')}：${source}` : source}
                    </div>
                  ))}
                </dd>
              </>
            )}
            <dt>应用边界</dt>
            <dd>
              {product.category === 'beauty'
                ? '以已确认的商品资料为准，不推断未确认的成分或功效。'
                : '保持实拍颜色、轮廓与结构，不增加未知材质或性能。'}
            </dd>
          </dl>
          {confirmed && (
            <p className="product-detail-note">这份已确认资料会作为生成与人工审核的依据。</p>
          )}
        </div>
        <footer className="product-dialog-footer">
          <button type="button" onClick={onClose}>
            关闭
          </button>
          {onStart && (
            <button type="button" className="work-primary" onClick={onStart}>
              用此商品创作 <ArrowRightOutlined aria-hidden="true" />
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
