import { Modal } from '../../shared/ui/Modal';
import { usageLabel, type loadSnapshot } from './api';

export function InputSnapshotDialog({
  snapshot,
  sku,
  onClose,
}: {
  snapshot: Awaited<ReturnType<typeof loadSnapshot>>;
  sku: string;
  onClose: () => void;
}) {
  const { draft, references } = snapshot;
  const video = draft.video_parameters;
  return (
    <Modal title="生成输入核对" onClose={onClose}>
      <div className="work-form">
        <p>
          {sku} · 商品资料 V{snapshot.product_fact_version} · 草稿 V{draft.version}
        </p>
        <p>
          {video
            ? `${video.ratio} · ${video.resolution} · ${video.duration} 秒`
            : `${draft.parameters.ratio} · ${draft.parameters.resolution} · ${draft.parameters.count} 张`}
        </p>
        <p className="creative-prewrap">{draft.prompt}</p>
        <p>商品实拍 {snapshot.product_photos.length} 张</p>
        {references.map((ref) => (
          <p key={ref.id}>
            {ref.label} · 文件 V{ref.file_version} · {usageLabel[ref.usage ?? 'expression']}
          </p>
        ))}
      </div>
    </Modal>
  );
}
