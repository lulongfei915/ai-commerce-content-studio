import {
  AimOutlined,
  DeleteOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Tooltip } from 'antd';
import type { Reference } from './api';

type Props = {
  references: Reference[];
  busy: boolean;
  preview?: (ref: Reference) => string | undefined;
  insert: (ref: Reference) => void;
  locate?: (ref: Reference) => void;
  remove: (ref: Reference) => void;
};

export function ReferenceStrip({
  references,
  busy,
  preview,
  insert,
  locate,
  remove,
}: Props) {
  return (
    <ul className="creative-references canvas-reference-strip" aria-label="参考素材">
      {references.map((ref, i) => {
        const src = preview?.(ref);
        return (
          <li key={ref.id}>
            <button
              type="button"
              className="canvas-ref-thumb"
              aria-label={`插入参考 ${i + 1} 标签`}
              title={`${ref.label} · V${ref.file_version} · 插入标签`}
              disabled={busy}
              onClick={() => insert(ref)}
            >
              {ref.media === 'video' ? (
                <VideoCameraOutlined aria-hidden="true" />
              ) : src ? (
                <img src={src} alt="" loading="lazy" />
              ) : (
                <FileImageOutlined aria-hidden="true" />
              )}
              <b>{i + 1}</b>
            </button>
            {locate && (
              <Tooltip title="定位来源" trigger={['hover', 'focus']} color="#303030">
                <button
                  type="button"
                  className="canvas-ref-action canvas-ref-locate"
                  aria-label={`定位参考 ${i + 1}`}
                  disabled={busy}
                  onClick={() => locate(ref)}
                >
                  <AimOutlined aria-hidden="true" />
                </button>
              </Tooltip>
            )}
            {ref.origin === 'independent' && (
              <Tooltip title="移除参考" trigger={['hover', 'focus']} color="#303030">
                <button
                  type="button"
                  className="canvas-ref-action canvas-ref-remove"
                  aria-label={`移除参考 ${i + 1}`}
                  disabled={busy}
                  onClick={() => remove(ref)}
                >
                  <DeleteOutlined aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </li>
        );
      })}
    </ul>
  );
}
