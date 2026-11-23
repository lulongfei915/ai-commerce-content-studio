import { useState } from 'react';
import type { XYPosition } from '@xyflow/react';

import { uploadMedia } from '../../shared/api/upload';
import { CaseBrowser } from '../cases/CaseBrowser';
import { actionError, draftWrite, usageLabel } from '../creation/api';
import type { Draft, ReferenceUsage } from '../creation/api';
import { CreationEditor } from '../creation/CreationEditor';
import { TaskResultPicker } from '../creation/TaskResultPicker';
import { photoPreviewUrl } from '../products/preview';
import { purposeLabel } from '../tasks/api';
import type { PanelState } from './CanvasBoard';
import { CanvasPanel } from './CanvasPanel';
import type { CanvasProps } from './CanvasPage';
import { nodePreview } from './api';
import type { Canvas } from './api';
import { allowedUsages } from './graph';
import { statusLabel } from './status';
import { VersionActions } from '../tasks/VersionActions';

export function CanvasPanelContent({
  panel,
  stage,
  anchor,
  sku,
  canvas,
  task,
  categories,
  session,
  drafts,
  edits,
  busy,
  onBusy,
  addPosition,
  onClose,
  onRefresh,
  onCreate,
  onActivate,
  onEdit,
  onLocate,
}: CanvasProps & {
  panel: PanelState;
  stage: HTMLElement;
  anchor?: HTMLElement | null;
  sku: string;
  canvas: Canvas;
  addPosition: (id: string, position?: XYPosition) => void;
  onClose: () => void;
  onRefresh: (draft?: Draft) => Promise<void>;
  onActivate: (draft: Draft) => void;
  onLocate: (id: string) => void;
}) {
  const [productId, setProductId] = useState(sku || task.products[0]?.id || '');
  const [purpose, setPurpose] = useState<'main' | 'detail'>('main');
  const [usage, setUsage] = useState<ReferenceUsage>();
  const [error, setError] = useState('');
  const token = session.csrf_token;
  const node = 'id' in panel ? canvas.nodes.find((item) => item.id === panel.id) : undefined;
  const draft =
    panel.kind === 'edit'
      ? drafts.find((item) => `creation:${item.id}` === panel.id)
      : panel.kind === 'connect'
        ? drafts.find((item) => `creation:${item.id}` === panel.target)
        : undefined;
  const product = task.products.find((item) => item.id === (draft?.product_id ?? productId));
  const title = {
    photos: '添加商品素材',
    cases: '加入案例',
    upload: '上传素材',
    results: '任务作品',
    image: '图片生成',
    video: '视频生成',
    connect: '连接参考',
    edit: node?.label ?? '创作设置',
    preview: node?.label ?? '媒体预览',
  }[panel.kind];
  const source =
    panel.kind === 'connect' ? canvas.nodes.find((item) => item.id === panel.source) : undefined;
  const choices = source && draft ? allowedUsages(source, draft) : [];
  const selectedUsage = usage ?? choices[0];
  const preview =
    node?.previewable && node.file_version
      ? nodePreview(task.id, node.id, node.file_version, node.source_version ?? undefined)
      : undefined;

  async function run(operation: () => Promise<void>) {
    onBusy(true);
    setError('');
    try {
      await operation();
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      onBusy(false);
    }
  }

  return (
    <CanvasPanel
      title={title}
      onClose={onClose}
      stage={stage}
      anchor={anchor}
      returnFocusId={'id' in panel ? panel.id : panel.kind === 'connect' ? panel.target : undefined}
      busy={busy}
      editor={panel.kind === 'edit'}
    >
      {error && (
        <p role="alert" className="work-error">
          {error}
        </p>
      )}
      {(panel.kind === 'image' || panel.kind === 'video' || panel.kind === 'photos') && (
        <div className="work-form">
          <label>
            商品 SKU{' '}
            <select
              value={productId}
              disabled={busy}
              onChange={(event) => setProductId(event.target.value)}
            >
              {task.products.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.sku} · {item.name}
                </option>
              ))}
            </select>
          </label>
          {panel.kind === 'photos' ? (
            product?.photos.length ? (
              <div className="canvas-photo-picker">
                {product.photos.map((photo, index) => {
                  const id = `upload:${photo.file_id}`;
                  const added = canvas.nodes.some((item) => item.id === id);
                  return (
                    <button
                      key={photo.file_id}
                      type="button"
                      disabled={added || busy}
                      onClick={() => {
                        addPosition(id, panel.position);
                        onClose();
                      }}
                    >
                      <img loading="lazy" src={photoPreviewUrl(product.id, photo.file_id)} alt="" />
                      <span>
                        {added ? '已添加' : `实拍 ${index + 1}`} · V{photo.version}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="work-muted">该 SKU 暂无商品实拍。</p>
            )
          ) : (
            <>
              {panel.kind === 'image' && (
                <label>
                  用途{' '}
                  <select
                    value={purpose}
                    onChange={(event) =>
                      setPurpose(event.target.value === 'detail' ? 'detail' : 'main')
                    }
                  >
                    <option value="main">主图</option>
                    <option value="detail">详情素材</option>
                  </select>
                </label>
              )}
              <footer className="work-actions">
                <button
                  type="button"
                  className="work-primary"
                  disabled={busy || !product}
                  onClick={() => {
                    if (!product) return;
                    const draftPurpose = panel.kind === 'video' ? 'video' : purpose;
                    const primary = !drafts.some(
                      (item) =>
                        item.product_id === product.id &&
                        item.purpose === draftPurpose &&
                        item.slot === 'primary',
                    );
                    void onCreate(product.id, draftPurpose, primary).then(async (created) => {
                      if (!created) return;
                      addPosition(`creation:${created.id}`, panel.position);
                      await onRefresh();
                      onActivate(created);
                    });
                  }}
                >
                  新建{panel.kind === 'video' ? '视频' : '图片'}节点
                </button>
              </footer>
            </>
          )}
        </div>
      )}
      {panel.kind === 'cases' && (
        <CaseBrowser
          categories={categories}
          allowVideo
          onPick={(item) => {
            addPosition(`case:${item.id}`, panel.position);
            onClose();
          }}
        />
      )}
      {panel.kind === 'upload' && (
        <label className="work-form">
          图片或 MP4
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              void run(async () => {
                const id = await uploadMedia(file, token);
                addPosition(`upload:${id}`, panel.position);
                onClose();
              });
            }}
          />
        </label>
      )}
      {panel.kind === 'results' && (
        <TaskResultPicker
          task={task}
          sku={sku}
          canPlayVideo={session.permissions.includes('download')}
          shownVersions={
            new Set(
              canvas.nodes.filter((item) => item.kind === 'result').map((item) => item.source_id),
            )
          }
          onReference={
            session.permissions.includes('create')
              ? (result) => {
                  addPosition(`result:${result.version_id}`, panel.position);
                  onClose();
                }
              : undefined
          }
        />
      )}
      {panel.kind === 'preview' && node && (
        <div className="work-form canvas-preview">
          {node.media === 'image' && preview && <img src={preview} alt={node.label} />}
          {node.kind === 'result' && node.media === 'image' && (
            <VersionActions
              id={node.source_id}
              key={node.source_id}
              task={task}
              session={session}
              refresh={() => void onRefresh()}
            />
          )}
          {node.media === 'video' && preview && session.permissions.includes('download') && (
            <video src={preview} preload="none" controls aria-label={node.label} />
          )}
          <p>
            {statusLabel[node.status] ?? node.status}
            {node.file_version ? ` · 文件 V${node.file_version}` : ''}
          </p>
          {node.execution_id && (
            <p>
              执行 {node.execution_id} · 结果 V{node.source_version}
            </p>
          )}
          {node.source_creation_id && (
            <button type="button" onClick={() => onLocate(`creation:${node.source_creation_id}`)}>
              定位来源节点
            </button>
          )}
        </div>
      )}
      {panel.kind === 'connect' && source && draft && (
        <form
          className="work-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!selectedUsage || busy) return;
            void run(async () => {
              const updated = await draftWrite(draft, token, '/references', {
                kind: source.kind,
                source_id: source.source_id,
                usage: selectedUsage,
                file_version: source.file_version,
                source_version: source.source_version,
              });
              await onRefresh(updated);
              onClose();
            });
          }}
        >
          <p>
            {source.label} · 文件 V{source.file_version} → {product?.sku} ·{' '}
            {purposeLabel[draft.purpose]}
          </p>
          <label>
            引用用途{' '}
            <select
              value={selectedUsage}
              onChange={(event) => setUsage(event.target.value as ReferenceUsage)}
            >
              {choices.map((item) => (
                <option key={item} value={item}>
                  {usageLabel[item]}
                </option>
              ))}
            </select>
          </label>
          <footer className="work-actions">
            <button type="submit" className="work-primary" disabled={busy}>
              连接参考
            </button>
          </footer>
        </form>
      )}
      {panel.kind === 'edit' && draft && product && (
        <CreationEditor
          key={draft.id}
          inCanvas
          draft={draft}
          product={product}
          categories={categories}
          token={token}
          edits={edits[draft.id]}
          onEdit={(next) => onEdit(draft.id, next)}
          onBusy={onBusy}
          onSaved={(updated) => void onRefresh(updated)}
          previewUrl={(ref) =>
            nodePreview(
              task.id,
              `${ref.kind}:${ref.source_id}`,
              ref.file_version,
              ref.source_version,
            )
          }
          onLocateReference={(ref) => onLocate(`${ref.kind}:${ref.source_id}`)}
        />
      )}
    </CanvasPanel>
  );
}
