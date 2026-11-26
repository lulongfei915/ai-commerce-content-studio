import { useRef, useState, type MouseEventHandler } from 'react';
import {
  CopyOutlined, DeleteOutlined, EllipsisOutlined, PictureOutlined, PlusOutlined, RightOutlined, SettingOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import type { Task } from '../tasks/api';
import { purposeLabel } from '../tasks/api';
import { photoPreviewUrl } from '../products/preview';
import { defaults, type Draft } from './api';
import { resultPreview, type TaskResult } from './results';
import type { BatchConfig, BatchExecution } from './useBatchProgress';
import type { BatchMedia } from './BatchTabs';
import { activeImageStatuses, archivedImageStatuses, canRetryExecution } from './useImageExecution';
import { batchPrompt } from './batch-labels';

export function BatchListHeader({ media, count, config, canCreate, busy, canAdd, onSettings, onAdd }: {
  media: BatchMedia;
  count: number;
  config?: BatchConfig;
  canCreate: boolean;
  busy: boolean;
  canAdd: boolean;
  onSettings: (trigger: HTMLButtonElement) => void;
  onAdd: (trigger: HTMLButtonElement) => void;
}) {
  const image = media === 'image';
  return (
    <>
      <div className="batch-common">
        <strong>公共设置</strong>
        <small>默认 · {image
          ? `${config?.ratio ?? defaults.ratio} · ${config?.resolution ?? defaults.resolution} · `
          : ''}{config?.count ?? 1} {image ? '张' : '条'}/项</small>
        {canCreate && <button className="batch-plain" type="button" aria-label="调整公共设置"
          disabled={busy} onClick={(event) => onSettings(event.currentTarget)}>
          调整 <SettingOutlined />
        </button>}
      </div>
      <div className="batch-list-heading">
        <h2>生成项清单 <small>{count}</small></h2>
        {canCreate && <button type="button" disabled={busy || !canAdd}
          onClick={(event) => onAdd(event.currentTarget)}>
          <PlusOutlined /> 新增{image ? '图片' : '视频'}项
        </button>}
      </div>
    </>
  );
}

export function BatchPhoto({ product }: { product?: Task['products'][number] }) {
  const photo = product?.photos[0];
  return (
    <span className="batch-product-thumb">
      {product && photo
        ? <img src={photoPreviewUrl(product.id, photo.file_id)} alt="" loading="lazy" />
        : <PictureOutlined aria-hidden="true" />}
    </span>
  );
}

function BatchRowThumbnail({ result, photo, number, disabled, onOpen }: {
  result?: string;
  photo?: string;
  number: string;
  disabled: boolean;
  onOpen: MouseEventHandler<HTMLButtonElement>;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const output = result && !failed.includes(result) ? result : undefined;
  const src = output ?? photo;
  if (!src || failed.includes(src)) return null;
  const image = <img src={src} alt="" loading="lazy" onError={() => setFailed((urls) => [...urls, src])} />;
  if (!output) return <span className="batch-product-thumb" title="商品实拍">{image}</span>;
  const label = `查看第 ${number} 项生成结果`;
  return (
    <button type="button" className="batch-product-thumb batch-result-thumb"
      aria-label={label} title={label} disabled={disabled} onClick={onOpen}>
      {image}
    </button>
  );
}

function BatchRowMenu({ number, product, submitted, disabled, onCopy, onRemove }: {
  number: string;
  product: string;
  submitted: boolean;
  disabled: boolean;
  onCopy: (trigger: HTMLButtonElement) => void;
  onRemove: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = `第 ${number} 项更多操作`;
  return (
    <Dropdown trigger={['click']} placement="bottomRight" disabled={disabled} autoFocus
      open={open && !disabled} onOpenChange={setOpen}
      menu={{
        items: [
          { key: 'copy', label: '复制生成项', icon: <CopyOutlined /> },
          ...(submitted ? [] : [{ key: 'remove', label: '删除此项', icon: <DeleteOutlined />, danger: true }]),
        ],
        onClick: ({ key }) => {
          setOpen(false);
          const button = trigger.current;
          if (!button) return;
          button.focus({ preventScroll: true });
          if (key === 'copy') onCopy(button);
          else if (window.confirm(`删除第 ${number} 项「${product}」？`)) onRemove();
        },
      }}>
      <button ref={trigger} type="button" className="batch-plain batch-icon" title={label} aria-label={label}
        aria-haspopup="menu" aria-expanded={open && !disabled} disabled={disabled}>
        <EllipsisOutlined aria-hidden="true" />
      </button>
    </Dropdown>
  );
}

function BatchItemStatus({ row, invalid }: { row?: BatchExecution; invalid: boolean }) {
  const outputs = row?.execution.outputs ?? [];
  const finished = outputs.filter((output) => archivedImageStatuses.has(output.status)).length;
  const running = outputs.some((output) => activeImageStatuses.has(output.status));
  const failed = row && outputs.some((output) => canRetryExecution(row.execution.media, output)
    || output.status === 'generation_failed');
  const status = invalid ? '待完善' : !row ? '未提交' : running
    ? outputs.every((output) => output.status === 'queued') ? '排队中' : '进行中'
    : failed ? '有失败' : finished === outputs.length ? '已完成' : '已结束';
  return (
    <div className="batch-item-state">
      <span data-tone={invalid || failed ? 'error' : running ? 'running' : finished ? 'ok' : undefined}>
        {status}
      </span>
      {outputs.length > 0 && <small>{finished}/{outputs.length} 份完成</small>}
    </div>
  );
}

export function BatchList({ task, items, rows, results, selection, invalid, busy, canCreate, onOpen, onCopy, onRemove }: {
  task: Task;
  items: Draft[];
  rows?: BatchExecution[];
  results?: TaskResult[];
  selection?: string;
  invalid?: string;
  busy: boolean;
  canCreate: boolean;
  onOpen: (item: Draft, trigger: HTMLButtonElement, row?: BatchExecution) => void;
  onCopy: (item: Draft, trigger: HTMLButtonElement) => void;
  onRemove: (item: Draft) => void;
}) {
  const executions = new Map(rows?.map((row) => [row.item_id, row]));
  const assets = new Map(results?.map((asset) => [asset.version_id, asset]));
  return (
    <ul className="batch-items" aria-label="生成项清单" tabIndex={0}>
      {items.map((item, index) => {
        const row = executions.get(item.id);
        const product = task.products.find((product) => product.id === item.product_id);
        const photo = product?.photos[0];
        const result = row?.execution.outputs.map(({ id }) => assets.get(id)).find((asset) =>
          asset?.execution_id === row.execution.id && asset?.creation_id === item.id &&
          asset.media === 'image' && asset.previewable && asset.file_version != null,
        );
        const src = result?.file_version
          ? resultPreview(result.task_id, result.version_id, result.file_version, result.version)
          : undefined;
        const number = String(index + 1).padStart(2, '0');
        const slot = task.positions.find((position) => position.id === item.batch_position_id);
        const parameters = item.video_parameters ?? item.parameters ?? defaults;
        const specs = `${parameters.ratio} · ${parameters.resolution} · ${item.video_parameters
          ? `${item.video_parameters.duration}s · ${parameters.count} 条` : `${parameters.count} 张`}`;
        const context = `${product?.name ?? ''} · ${product?.sku ?? ''} · ${slot?.module || purposeLabel[item.purpose]}`;
        const selected = selection === item.id;
        return (
          <li key={item.id} id={`batch-${item.id}`} className={[
            selected && 'batch-selected', invalid === item.id && 'batch-invalid',
          ].filter(Boolean).join(' ')}>
            <span className="batch-number">{number}</span>
            <div className="batch-item-content">
              <div className="batch-item-summary">
                <strong title={batchPrompt(item)}>{batchPrompt(item)}</strong>
                <small>{specs}</small>
              </div>
              <div className="batch-item-context">
                <BatchRowThumbnail number={number} result={src}
                  photo={product && photo ? photoPreviewUrl(product.id, photo.file_id) : undefined}
                  disabled={busy} onOpen={(event) => onOpen(item, event.currentTarget, row)} />
                <small title={context}>{context}</small>
              </div>
            </div>
            <BatchItemStatus row={row} invalid={invalid === item.id} />
            <div className="batch-item-actions">
              {(row || canCreate) && <button id={`batch-open-${item.id}`} className="batch-plain"
                type="button" aria-pressed={selected} disabled={busy || !rows}
                onClick={(event) => onOpen(item, event.currentTarget, row)}>
                {row ? '结果' : '编辑'} <RightOutlined aria-hidden="true" />
              </button>}
              {canCreate && <BatchRowMenu number={number} product={product?.name ?? item.product_id}
                submitted={Boolean(row)} disabled={busy || !rows}
                onCopy={(trigger) => onCopy(item, trigger)} onRemove={() => onRemove(item)} />}
            </div>
          </li>
        );
      })}
      {items.length === 0 && <li className="batch-empty">暂无生成项</li>}
    </ul>
  );
}
