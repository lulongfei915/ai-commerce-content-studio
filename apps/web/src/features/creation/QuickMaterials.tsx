import { useState } from 'react';
import { CheckOutlined, CloseOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import { CaseBrowser } from '../cases/CaseBrowser';
import type { Category, Product } from '../products/api';
import { photoPreviewUrl } from '../products/preview';
import { referencePreview, type Draft, type Reference } from './api';

export function QuickMaterials({
  product,
  purpose,
  categories,
  references,
  startWith,
  busy,
  error,
  onClose,
  onPhoto,
  onUploadPhoto,
  onUpload,
  onCase,
}: {
  product: Product;
  purpose: Draft['purpose'];
  categories: Category[];
  references: Reference[];
  startWith: 'product' | 'reference';
  busy: boolean;
  error?: string;
  onClose: () => void;
  onPhoto: (photo: Product['photos'][number]) => void;
  onUploadPhoto: (file: File) => void;
  onUpload: (file: File) => void;
  onCase: (id: string) => void;
}) {
  const [source, setSource] = useState(startWith);
  const chosen = new Set(references.map((ref) => ref.file_id));
  return (
    <Modal title="添加素材" busy={busy} onClose={onClose}>
      <div className="work-form">
        <div className="work-actions studio-material-options" role="group" aria-label="素材类型">
          <button
            type="button"
            aria-pressed={source === 'product'}
            disabled={busy}
            onClick={() => setSource('product')}
          >
            商品实拍
          </button>
          <button
            type="button"
            aria-pressed={source === 'reference'}
            disabled={busy}
            onClick={() => setSource('reference')}
          >
            参考图
          </button>
        </div>
        {error && <p role="alert">{error}</p>}
        {source === 'product' && product.photos.length < 8 && (
          <MaterialUpload label="上传并绑定商品实拍" disabled={busy} upload={onUploadPhoto} />
        )}
        {source === 'product' ? (
          product.photos.length ? (
            <div className="studio-material-choices">
              {product.photos.map((photo, index) => {
                const added = chosen.has(photo.file_id);
                return (
                  <button
                    key={photo.file_id}
                    type="button"
                    disabled={busy || added}
                    aria-label={`${added ? '已添加' : '添加'}实拍 ${index + 1}`}
                    onClick={() => onPhoto(photo)}
                  >
                    <img src={photoPreviewUrl(product.id, photo.file_id)} alt="" />
                    <span>
                      {added && <CheckOutlined aria-hidden="true" />} 实拍 {index + 1}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="work-muted">当前商品暂无已绑定实拍。</p>
          )
        ) : (
          <>
            <MaterialUpload label={purpose === 'video' ? '上传参考素材' : '上传参考图'}
              video={purpose === 'video'} disabled={busy} upload={onUpload} />
            <CaseBrowser
              categories={categories}
              category={product.category}
              purpose={purpose}
              imageOnly={purpose !== 'video'}
              allowVideo={purpose === 'video'}
              disabled={busy}
              onPick={(item) => onCase(item.id)}
            />
          </>
        )}
      </div>
    </Modal>
  );
}

function MaterialUpload({
  label,
  disabled,
  upload,
  video = false,
}: {
  label: string;
  disabled: boolean;
  upload: (file: File) => void;
  video?: boolean;
}) {
  return (
    <label className="creative-upload">
      {label}
      <input
        type="file"
        accept={`image/jpeg,image/png,image/webp${video ? ',video/mp4' : ''}`}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) upload(file);
        }}
      />
    </label>
  );
}

export function SelectedQuickMaterials({
  draft,
  disabled,
  remove,
}: {
  draft: Draft;
  disabled: boolean;
  remove: (ref: Reference) => void;
}) {
  if (!draft.references.length) return null;
  return (
    <ul className="studio-materials" aria-label="本次生成素材">
      {draft.references.map((ref) => (
        <li key={ref.id}>
          {ref.media === 'video' ? (
            <VideoCameraOutlined aria-hidden="true" />
          ) : (
            <img src={referencePreview(draft, ref)} alt={ref.label} />
          )}
          <span title={ref.label}>
            <b>{ref.usage === 'product' ? '商品实拍' : ref.media === 'video' ? '参考视频' : '参考图'}</b>
            <small>{ref.label}</small>
          </span>
          {ref.origin === 'independent' && (
            <button
              type="button"
              disabled={disabled}
              aria-label={`移除 ${ref.label}`}
              title={`移除 ${ref.label}`}
              onClick={() => remove(ref)}
            >
              <CloseOutlined aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
