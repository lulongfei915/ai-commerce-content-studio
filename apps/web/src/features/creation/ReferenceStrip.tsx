import {
  AimOutlined,
  DeleteOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { usageLabel } from './api';
import type { Reference } from './api';

type Props = {
  references: Reference[];
  busy: boolean;
  video: boolean;
  preview?: (ref: Reference) => string | undefined;
  insert: (ref: Reference) => void;
  locate?: (ref: Reference) => void;
  remove: (ref: Reference) => void;
  updateUsage: (ref: Reference, usage: string) => void;
};

export function ReferenceStrip({
  references,
  busy,
  video,
  preview,
  insert,
  locate,
  remove,
  updateUsage,
}: Props) {
  return (
    <ul className="creative-references canvas-reference-strip" aria-label="参考素材">
      {references.map((ref, i) => (
        <li key={ref.id}>
          <button
            className="canvas-ref-thumb"
            aria-label={`插入参考 ${i + 1} 标签`}
            title={`${ref.label} · V${ref.file_version} · 插入标签`}
            disabled={busy}
            onClick={() => insert(ref)}
          >
            {ref.media === 'video' ? (
              <VideoCameraOutlined />
            ) : preview?.(ref) ? (
              <img src={preview(ref)} alt="" loading="lazy" />
            ) : (
              <FileImageOutlined />
            )}
            <b>{i + 1}</b>
          </button>
          <div className="canvas-ref-tools">
            {ref.origin === 'independent' ? (
              <select
                aria-label={`参考 ${i + 1} 用途`}
                value={ref.usage ?? 'expression'}
                disabled={busy}
                onChange={(event) => updateUsage(ref, event.target.value)}
              >
                {Object.entries(usageLabel)
                  .filter(
                    ([id]) =>
                      id === ref.usage ||
                      (id !== 'product' && (video || !['first_frame', 'last_frame'].includes(id))),
                  )
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </select>
            ) : (
              <small>{usageLabel[ref.usage ?? 'expression']}</small>
            )}
            {locate && (
              <button
                aria-label={`定位参考 ${i + 1}`}
                title="定位来源"
                disabled={busy}
                onClick={() => locate(ref)}
              >
                <AimOutlined />
              </button>
            )}
            {ref.origin === 'independent' && (
              <button
                aria-label={`移除参考 ${i + 1}`}
                title="移除参考"
                disabled={busy}
                onClick={() => remove(ref)}
              >
                <DeleteOutlined />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
