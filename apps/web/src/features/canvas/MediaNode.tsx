import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';

import type { FlowNode } from './graph';
import { statusLabel } from './status';

export const MediaNode = memo(function MediaNode({ data, isConnectable }: NodeProps<FlowNode>) {
  const { kind, media, label, sku, status, file_version, source_version, preview } = data;
  const imageDraft = kind === 'creation' && media === 'image';
  const imageAsset = kind !== 'creation' && media === 'image' && Boolean(preview);
  const state = statusLabel[status] ?? status;
  const context = [sku, data.purpose].filter(Boolean).join(' · ');
  const version = kind === 'result' ? source_version : file_version;
  const title = [label, context, imageAsset ? state : ''].filter(Boolean).join(' · ');
  const imageClass = imageDraft ? ' canvas-image-node' : imageAsset ? ' canvas-image-asset' : '';
  return (
    <div className={`canvas-node canvas-node-${kind}${imageClass}`}>
      {kind === 'creation' && (
        <Handle id="input" type="target" position={Position.Left} isConnectable={isConnectable} />
      )}
      {kind === 'result' && (
        <Handle id="origin" type="target" position={Position.Top} isConnectable={false} />
      )}
      <div className="canvas-node-heading">
        {media === 'video' ? <VideoCameraOutlined aria-hidden="true" /> : <PictureOutlined aria-hidden="true" />}
        <b title={imageDraft || imageAsset ? title : label}>{label}</b>
        {imageDraft && <span className="canvas-image-node-status">{state}</span>}
        {imageAsset && version && <span className="canvas-image-node-status">V{version}</span>}
      </div>
      <div className="canvas-node-media">
        {preview && media === 'image' ? (
          <img loading="lazy" draggable={false} src={preview} alt="" />
        ) : (
          <span className="canvas-media-symbol" aria-hidden="true">
            {media === 'video' ? <VideoCameraOutlined /> : <PictureOutlined />}
          </span>
        )}
      </div>
      {!imageDraft && !imageAsset && <div className="canvas-node-meta">
        <span>
          {sku ?? (kind === 'case' ? '案例' : '素材')}
          {data.purpose && ` · ${data.purpose}`}
          {version ? ` · V${version}` : ''}
        </span>
        <span>{state}</span>
      </div>}
      {kind === 'creation' ? (
        <Handle id="output" type="source" position={Position.Bottom} isConnectable={false} />
      ) : (
        <Handle
          id="reference"
          type="source"
          position={Position.Right}
          isConnectable={isConnectable && data.referenceable}
        />
      )}
    </div>
  );
});
