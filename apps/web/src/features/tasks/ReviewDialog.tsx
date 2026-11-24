import { useState } from 'react';
import { FullscreenExitOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import type { Session } from '../auth/session';
import { statusLabel } from '../canvas/status';
import { resultPreview, type TaskResult } from '../creation/results';
import { photoPreviewUrl } from '../products/preview';
import { purposeLabel, type Task } from './api';
import { VersionActions } from './VersionActions';
import './review-dialog.css';

export function ReviewDialog({
  item,
  task,
  session,
  error,
  onClose,
  onApproved,
  refresh,
}: {
  item: TaskResult;
  task?: Task;
  session: Session;
  error: string;
  onClose: () => void;
  onApproved: () => void;
  refresh: () => void;
}) {
  const [asset, setAsset] = useState(item);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const [zoom, setZoom] = useState<'result' | 'source'>();
  const [photoIndex, setPhotoIndex] = useState(0);
  const product = task?.products.find((entry) => entry.id === asset.product_id);
  const sku = product?.sku ?? item.sku;
  const purpose =
    asset.purpose === 'main' || asset.purpose === 'detail' || asset.purpose === 'video'
      ? purposeLabel[asset.purpose]
      : '制作素材';
  const photos = product?.photos ?? [];
  const photo = photos[photoIndex] ?? photos[0];
  const title = product ? `${product.name} · ${purpose}` : (sku ?? purpose);
  const pending = asset.status === 'pending_review';
  const result =
    asset.previewable && asset.file_version
      ? resultPreview(asset.task_id, asset.version_id, asset.file_version, asset.version)
      : undefined;

  function zoomButton(pane: 'result' | 'source', label: string, src: string, alt: string) {
    const expanded = zoom === pane;
    return (
      <button
        className="review-media"
        type="button"
        aria-label={`${expanded ? '还原' : '放大'}${label}`}
        aria-pressed={expanded}
        onClick={() => setZoom(expanded ? undefined : pane)}
      >
        <img src={src} alt={alt} />
        <span className="review-zoom" aria-hidden="true">
          {expanded ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
        </span>
      </button>
    );
  }

  return (
    <Modal title={item.status === 'pending_review' ? '素材审核' : '素材详情'} onClose={onClose}>
      <div className="review-dialog-body">
        <div className="review-dialog-heading">
          <div>
            <h3>{title}</h3>
            <p>{[sku, task?.name].filter(Boolean).join(' · ')}</p>
          </div>
          <span className="review-dialog-status" data-status={asset.status}>
            {statusLabel[asset.status] ?? asset.status}
          </span>
        </div>
        <div className="review-comparison" data-zoom={zoom}>
          <figure data-pane="result">
            <figcaption>生成结果 · V{asset.version}</figcaption>
            {result && asset.media === 'image' ? (
              zoomButton('result', '生成结果', `${result}&detailed=true`, asset.label)
            ) : result && session.permissions.includes('download') ? (
              <video className="review-media" controls preload="metadata" src={result} />
            ) : (
              <div className="review-media review-empty">暂无预览</div>
            )}
          </figure>
          <figure data-pane="source">
            <figcaption>商品实拍{sku && ` · ${sku}`}</figcaption>
            {product && photo ? (
              zoomButton(
                'source',
                '商品实拍',
                photoPreviewUrl(product.id, photo.file_id),
                `${product.name} · 商品实拍`,
              )
            ) : (
              <div className="review-media review-empty">
                {task ? '暂无商品实拍' : '实拍待加载'}
              </div>
            )}
            {photos.length > 1 && (
              <div className="review-photo-options" role="group" aria-label="选择商品实拍">
                {photos.map((entry, index) => (
                  <button
                    key={entry.file_id}
                    type="button"
                    aria-label={`实拍 ${index + 1}`}
                    aria-pressed={entry.file_id === photo?.file_id}
                    onClick={() => setPhotoIndex(index)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>
            )}
          </figure>
        </div>
        {error && (
          <p role="alert" className="work-error">
            {error}
          </p>
        )}
        {task && (
          <VersionActions
            id={asset.version_id}
            task={task}
            session={session}
            refresh={refresh}
            reviewFooter={footer}
            onAssetChange={setAsset}
            onApproved={onApproved}
          />
        )}
      </div>
      {pending && session.permissions.includes('review') && (
        <footer className="review-dialog-footer" ref={setFooter}>
          <small>审核决定仅绑定当前版本</small>
        </footer>
      )}
    </Modal>
  );
}
