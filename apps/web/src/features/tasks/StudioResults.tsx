import { useState } from 'react';
import {
  CheckOutlined,
  ControlOutlined,
  PictureOutlined,
  SafetyOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import { resultPreview, type TaskResult } from '../creation/results';
import { statusLabel } from '../canvas/status';
import { VersionActions } from './VersionActions';
import type { Session } from '../auth/session';
import type { Task } from './api';
import white from './sneaker-white.jpg';
import studio from './sneaker-studio.jpg';

type Artwork = {
  id: string;
  name: string;
  type: string;
  media: string;
  status: string;
  src?: string;
  version?: number | null;
  assetId?: string;
  style?: string;
  caption?: string;
};
const examples: Artwork[] = [
  {
    id: 'minimal',
    name: '轻行系列 · 氛围主图',
    type: '商品主图',
    style: 'minimal',
    src: white,
    caption: '轻一点，自在一点',
  },
  {
    id: 'editorial',
    name: '城市轻行 · 创意主图',
    type: '商品主图',
    style: 'editorial',
    src: studio,
    caption: 'MOVE\nYOUR\nEVERYDAY.',
  },
  {
    id: 'detail',
    name: '细节之美 · 鞋面特写',
    type: '详情素材',
    style: 'detail',
    src: white,
    caption: '好看，也经得起细看。',
  },
  {
    id: 'square',
    name: '轻行系列 · 商品全貌',
    type: '详情素材',
    style: 'square',
    src: studio,
    caption: 'A CLOSER LOOK / 02',
  },
].map((item) => ({ ...item, media: 'image', status: 'example' }));

function Preview({ item }: { item: Artwork }) {
  return (
    <span className={`studio-art ${item.style ?? ''}`}>
      {item.src && item.media === 'image' ? (
        <img alt={item.name} src={item.src} />
      ) : item.media === 'video' ? (
        <VideoCameraOutlined />
      ) : (
        <PictureOutlined />
      )}
      {item.caption && <strong>{item.caption}</strong>}
      {item.style === 'minimal' && <small>THE EVERYDAY COLLECTION</small>}
      {item.style === 'editorial' && <small>LESS NOISE. MORE YOU.</small>}
    </span>
  );
}
export function StudioResults({
  results,
  taskId,
  status = '',
  onStatus,
  canPlayVideo = false,
  task,
  session,
  refresh,
}: {
  results: TaskResult[];
  taskId?: string;
  status?: string;
  onStatus?: (value: string) => void;
  canPlayVideo?: boolean;
  task?: Task;
  session?: Session;
  refresh?: () => void;
}) {
  const [media, setMedia] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<Artwork[]>([]);
  const [filter, setFilter] = useState(false);
  const gallery: Artwork[] = taskId
    ? results.map((result) => ({
        id: result.version_id,
        assetId: result.asset_id,
        name: result.label,
        type: result.media === 'video' ? '视频' : '图片',
        media: result.media,
        status: result.status,
        version: result.version,
        src:
          result.previewable && result.file_version
            ? resultPreview(taskId, result.version_id, result.file_version, result.version)
            : undefined,
      }))
    : examples;
  const visible = gallery.filter(
    (item) => (media === 'all' || media === item.media) && (!status || status === item.status),
  );
  const picked = gallery.filter((item) => selected.includes(item.id));
  return (
    <section id="studio-results" className="studio-results" aria-label="创作结果">
      <header>
        <h2>
          创作结果 <SafetyOutlined />
        </h2>
        <div className="studio-tabs" aria-label="结果媒体类型">
          {Object.entries({ all: '全部', image: '图片', video: '视频' }).map(([key, label]) => (
            <button key={key} aria-pressed={media === key} onClick={() => setMedia(key)}>
              {label} {media === key && <small>{visible.length}</small>}
            </button>
          ))}
        </div>
        {onStatus && (
          <button
            className="studio-filter"
            aria-expanded={filter}
            onClick={() => setFilter(!filter)}
          >
            <ControlOutlined /> {statusLabel[status] ?? '筛选'}
          </button>
        )}
      </header>
      {filter && (
        <label className="studio-filter-options">
          审核状态{' '}
          <select value={status} onChange={(e) => onStatus?.(e.target.value)}>
            <option value="">全部状态</option>
            {Array.from(
              new Set([
                taskId ? 'pending_review' : 'needs_review',
                'approved',
                'rejected',
                ...results.map((item) => item.status),
              ]),
            ).map((id) => (
              <option key={id} value={id}>
                {statusLabel[id] ?? id}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="studio-result-grid">
        {visible.map((item) => (
          <article
            key={item.id}
            className="studio-result-card"
            data-asset-id={item.assetId}
            data-version-id={item.assetId ? item.id : undefined}
          >
            <button
              className="studio-preview"
              aria-label={`查看 ${item.name}`}
              onClick={() => setPreview([item])}
            >
              <Preview item={item} />
            </button>
            <span className="studio-type">
              <PictureOutlined /> {item.type}
            </span>
            <button
              className="studio-check"
              aria-label={`选择 ${item.name}`}
              aria-pressed={selected.includes(item.id)}
              disabled={!selected.includes(item.id) && picked.length >= 2}
              onClick={() =>
                setSelected(
                  selected.includes(item.id)
                    ? selected.filter((id) => id !== item.id)
                    : [...selected, item.id],
                )
              }
            >
              {selected.includes(item.id) && <CheckOutlined />}
            </button>
            <footer>
              <b>{item.name}</b>
              <div>
                <span>
                  {item.status === 'example'
                    ? '原型示例'
                    : (statusLabel[item.status] ?? item.status)}
                </span>
                {item.version && <small>V{item.version}</small>}
              </div>
            </footer>
          </article>
        ))}
      </div>
      {!visible.length && <p className="studio-empty">暂无符合条件的结果</p>}
      {!!picked.length && (
        <div className="work-actions">
          已选 {picked.length} 份{' '}
          <button disabled={picked.length !== 2} onClick={() => setPreview(picked)}>
            并排对比
          </button>
          <button onClick={() => setSelected([])}>取消选择</button>
        </div>
      )}
      {!!preview.length && (
        <Modal
          title={preview.length === 1 ? preview[0].name : '并排对比'}
          onClose={() => setPreview([])}
        >
          <div className="studio-comparison">
            {preview.map((item) => (
              <figure key={item.id}>
                {item.media === 'video' && item.src && canPlayVideo ? (
                  <video src={item.src} preload="none" controls aria-label={item.name} />
                ) : (
                  <Preview item={item} />
                )}
                <figcaption>
                  {item.name} ·{' '}
                  {item.status === 'example'
                    ? '原型示例'
                    : `${statusLabel[item.status] ?? item.status} · V${item.version}`}
                </figcaption>
                {task && session && refresh && item.assetId && item.media === 'image' && (
                  <VersionActions
                    key={item.id}
                    id={item.id}
                    task={task}
                    session={session}
                    refresh={refresh}
                  />
                )}
              </figure>
            ))}
          </div>
        </Modal>
      )}
    </section>
  );
}
