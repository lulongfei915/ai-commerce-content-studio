import { PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';

const types = ['image', 'video'] as const;
export type BatchMedia = typeof types[number];

export function BatchTabs({ media, busy, onChange }: {
  media: BatchMedia;
  busy: boolean;
  onChange: (media: BatchMedia) => void;
}) {
  return (
    <header className="batch-heading">
      <div className="batch-modes" role="tablist" aria-label="批量媒体类型" onKeyDown={(event) => {
        const index = ['Home', 'End'].indexOf(event.key);
        const next = types[index] ?? (['ArrowLeft', 'ArrowRight'].includes(event.key)
          ? media === 'image' ? 'video' : 'image' : undefined);
        if (!next) return;
        event.preventDefault();
        event.currentTarget.querySelector<HTMLButtonElement>(`#batch-tab-${next}`)?.focus();
        onChange(next);
      }}>
        {types.map((type) => (
          <button key={type} type="button" role="tab" id={`batch-tab-${type}`}
            aria-selected={media === type} aria-controls="batch-workspace"
            tabIndex={media === type ? 0 : -1} disabled={busy} onClick={() => onChange(type)}>
            {type === 'image' ? <PictureOutlined /> : <VideoCameraOutlined />}
            {type === 'image' ? '批量图片' : '批量视频'}
          </button>
        ))}
      </div>
    </header>
  );
}
