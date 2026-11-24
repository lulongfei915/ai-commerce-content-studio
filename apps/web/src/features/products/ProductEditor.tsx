import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRightOutlined, UploadOutlined } from '@ant-design/icons';

import { ApiError } from '../../shared/api/client';
import { Modal } from '../../shared/ui/Modal';
import { createProduct, updateFacts, uploadPhoto } from './api';
import type { Category, Facts, Product } from './api';
import { photoPreviewUrl } from './preview';
import { specificationKey, specificationLabel, specificationText } from './specification';
import './products.css';

type Props = {
  categories: Category[];
  token: string;
  product?: Product;
  inSetup?: boolean;
  onClose: () => void;
  onSave: (product: Product, start: boolean) => void;
};

export function ProductEditor({ categories, product, token, inSetup, onClose, onSave }: Props) {
  const [category, setCategory] = useState<Category['id']>(product?.category ?? categories[0].id);
  const originalSpecification = specificationText(
    product,
    categories.find((item) => item.id === product?.category),
  );
  const [specification, setSpecification] = useState(originalSpecification);
  const [existingPhotos, setExistingPhotos] = useState(product?.photos ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const [uploads, setUploads] = useState<Map<File, string>>(() => new Map());
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const count = existingPhotos.length + files.length;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const start = submitter?.getAttribute('value') === 'start';
    const value = specification.trim();
    const filled: Facts =
      product && value === originalSpecification.trim()
        ? product.facts
        : value
          ? { [specificationKey]: { value, evidence: '录入人已核对商品信息' } }
          : {};
    if ((Object.keys(filled).length || count) && !confirmed) {
      setError('请核对并确认已填写的事实和实拍。');
      return;
    }
    const name = String(form.get('name') ?? '').trim();
    const sku = String(form.get('sku') ?? '').trim();
    if (!product && (!name || !sku)) {
      setError('请填写商品名称和 SKU。');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const photo_ids = existingPhotos.map((photo) => photo.file_id);
      for (const file of files) {
        const id = uploads.get(file) ?? (await uploadPhoto(file, token));
        setUploads((current) => new Map(current).set(file, id));
        photo_ids.push(id);
      }
      const saved = product
        ? await updateFacts(
            product.id,
            { expected_version: product.version, facts: filled, photo_ids },
            token,
          )
        : await createProduct({ name, sku, category, facts: filled, photo_ids }, token);
      onSave(saved, start);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'product_sku_duplicate')
        setError('此 SKU 已存在，请返回并选择已有商品。');
      else if (cause instanceof ApiError && cause.code === 'version_conflict')
        setError('资料已被更新。请关闭并重新打开，再核对已保存的内容。');
      else if (cause instanceof ApiError && cause.status === 422)
        setError('资料未通过校验，请检查字段与实拍。');
      else
        setError(
          cause instanceof Error && !(cause instanceof ApiError)
            ? cause.message
            : '商品未保存，请重试。',
        );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={product ? '编辑商品资料' : '添加新商品'} onClose={onClose} busy={busy}>
      <form
        className="product-editor"
        onSubmit={(event) => {
          void save(event);
        }}
      >
        <div className="product-dialog-body">
          <fieldset disabled={busy} className="work-form product-fields">
            <label className="product-upload">
              <span className="product-upload-icon">
                <UploadOutlined aria-hidden="true" />
              </span>
              <span>
                <strong>上传商品实拍</strong>
                <small>JPG、PNG 或 WebP，单张不超过 10 MB，最多 8 张</small>
              </span>
              <input
                aria-label="上传商品实拍"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={(event) => {
                  const next = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  if (!next.length) return;
                  if (
                    count + next.length > 8 ||
                    next.some(
                      (file) =>
                        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                        file.size > 10 * 1024 * 1024 ||
                        !file.size,
                    )
                  ) {
                    setError('实拍最多 8 张，每张须为 10 MB 以内的 JPG、PNG 或 WebP。');
                    return;
                  }
                  setFiles((current) => [...current, ...next]);
                  setError('');
                  setConfirmed(false);
                }}
              />
            </label>
            {count > 0 && (
              <ul className="photo-list">
                {product &&
                  existingPhotos.map((photo, index) => (
                    <li key={photo.file_id}>
                      <img
                        src={photoPreviewUrl(product.id, photo.file_id)}
                        alt={`实拍 ${index + 1}`}
                      />
                      <button
                        type="button"
                        aria-label={`移除实拍 ${index + 1}`}
                        onClick={() => {
                          setExistingPhotos((current) =>
                            current.filter((item) => item.file_id !== photo.file_id),
                          );
                          setConfirmed(false);
                        }}
                      >
                        移除
                      </button>
                    </li>
                  ))}
                {files.map((file, index) => (
                  <li key={index}>
                    <LocalPhoto file={file} />
                    <button
                      type="button"
                      aria-label={`移除 ${file.name}`}
                      onClick={() => {
                        setFiles((current) => current.filter((_, i) => i !== index));
                        setConfirmed(false);
                      }}
                    >
                      移除
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!product && (
              <label>
                商品名称
                <input name="name" required maxLength={80} placeholder="例如：轻行低帮运动鞋" />
              </label>
            )}
            <div className="product-field-row">
              {!product && (
                <label>
                  SKU 编码
                  <input name="sku" required maxLength={60} placeholder="例如 NEW-001" />
                </label>
              )}
              <label>
                商品品类
                <select
                  value={category}
                  disabled={Boolean(product)}
                  onChange={(event) => {
                    setCategory(event.target.value as Category['id']);
                    setConfirmed(false);
                  }}
                >
                  {categories.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {specificationLabel}
              <textarea
                rows={3}
                maxLength={500}
                value={specification}
                placeholder="例如：米白色、低帮、36–44 码。只填写已确认的信息。"
                onChange={(event) => {
                  setSpecification(event.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label className="work-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              我已核对实拍和上述商品信息
            </label>
          </fieldset>
        </div>
        {error && (
          <p className="work-error" role="alert">
            {error}
          </p>
        )}
        <footer className="product-dialog-footer">
          <button type="button" disabled={busy} onClick={onClose}>
            {inSetup ? '返回选择' : '取消'}
          </button>
          <button
            type="submit"
            className={product || inSetup ? 'work-primary' : undefined}
            disabled={busy}
          >
            {busy ? '保存中…' : inSetup ? '保存并选中' : '保存商品'}
          </button>
          {!product && !inSetup && (
            <button type="submit" className="work-primary" value="start" disabled={busy}>
              <ArrowRightOutlined aria-hidden="true" /> 保存并开始制作
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}

function LocalPhoto({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return (
    <>
      {url && <img src={url} alt="" />}
      <span>{file.name}</span>
    </>
  );
}
