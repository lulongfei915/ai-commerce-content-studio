import { useLayoutEffect, useRef, useState } from 'react';
import { ClockCircleOutlined, PictureOutlined } from '@ant-design/icons';

import { Modal } from '../../shared/ui/Modal';
import type { Session } from '../auth/session';
import { statusLabel } from '../canvas/status';
import { photoPreviewUrl } from '../products/preview';
import { resultPreview, type TaskResult } from '../creation/results';
import { purposeLabel, type Task } from './api';
import { VersionActions } from './VersionActions';
import './review-dialog.css';
import './asset-detail-drawer.css';

export function AssetDetailDrawer({ item, task, session, refresh, onClose, showVersionTools }: {
  item: TaskResult;
  task: Task;
  session: Session;
  refresh: () => void;
  onClose: () => void;
  showVersionTools?: boolean;
}) {
  const [asset, setAsset] = useState(item);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  const [source, setSource] = useState<string>();
  const expandedPhoto = useRef<HTMLImageElement>(null);
  useLayoutEffect(() => {
    if (source) expandedPhoto.current?.scrollIntoView?.({ block: 'nearest' });
  }, [source]);
  const product = task.products.find((entry) => entry.id === asset.product_id);
  const purpose = asset.purpose === 'main' || asset.purpose === 'detail' || asset.purpose === 'video'
    ? purposeLabel[asset.purpose] : '制作素材';
  const preview = asset.previewable && asset.file_version
    ? resultPreview(asset.task_id, asset.version_id, asset.file_version, asset.version) : undefined;
  const canReview = asset.status === 'pending_review' && session.permissions.includes('review');

  return (
    <Modal title="素材详情" onClose={onClose} className="asset-detail-drawer" dismissOnBackdrop>
      <div className="asset-detail-body">
        <div className="asset-detail-preview">
          {preview && asset.media === 'image' ? <img src={`${preview}&detailed=true`} alt={asset.label} />
            : preview && session.permissions.includes('download') ? <video controls preload="metadata" src={preview} />
              : <span><PictureOutlined /> 暂无预览</span>}
        </div>
        <div className="asset-detail-heading">
          <h3>{product?.name || asset.sku || purpose} · {purpose}</h3>
          <span className="review-dialog-status" data-status={asset.status}>
            {asset.status === 'pending_review' && <ClockCircleOutlined aria-hidden="true" />}
            {statusLabel[asset.status] ?? asset.status}
          </span>
        </div>
        <p className="work-muted">{[product?.sku || asset.sku, purpose, `版本 V${asset.version}`].filter(Boolean).join(' · ')}</p>
        <h3>商品实拍对照</h3>
        {product?.photos.length ? (
          <div className="asset-detail-photos">
            {product.photos.map((photo, index) => (
              <button key={photo.file_id} type="button" aria-label={`查看实拍 ${index + 1}`}
                aria-pressed={source === photo.file_id}
                onClick={() => setSource(source === photo.file_id ? undefined : photo.file_id)}>
                <img src={photoPreviewUrl(product.id, photo.file_id)} alt="" />
              </button>
            ))}
            {source && <img ref={expandedPhoto} className="asset-detail-photo-expanded" src={photoPreviewUrl(product.id, source)}
              alt={`${product.name} · 商品实拍`} />}
          </div>
        ) : <p className="work-muted">暂无商品实拍</p>}
        <VersionActions id={asset.version_id} task={task} session={session}
          refresh={refresh} reviewFooter={footer} onAssetChange={setAsset} focusRejectionReason
          showVersionTools={showVersionTools} />
      </div>
      {canReview && <footer className="review-dialog-footer" ref={setFooter} />}
    </Modal>
  );
}
