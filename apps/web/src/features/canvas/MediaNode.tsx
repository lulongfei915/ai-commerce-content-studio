import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';

import type { FlowNode } from './graph';
import { statusLabel } from './status';

export const MediaNode = memo(function MediaNode({ data, isConnectable }: NodeProps<FlowNode>) {
  const { kind, media, label, sku, status, file_version, source_version, preview } = data;
  return (
    <div className={`canvas-node canvas-node-${kind}`}>
      {kind === 'creation' && (
        <Handle id="input" type="target" position={Position.Left} isConnectable={isConnectable} />
      )}
      {kind === 'result' && (
        <Handle id="origin" type="target" position={Position.Top} isConnectable={false} />
      )}
      <div className="canvas-node-heading">
        <b title={label}>{label}</b>
        <span>{media === 'video' ? '视频' : '图片'}</span>
      </div>
      <div className="canvas-node-media">
        {preview && media === 'image' ? (
          <img loading="lazy" draggable={false} src={preview} alt="" />
        ) : (
          <span className="canvas-media-symbol" aria-hidden="true">
            {media === 'video' ? '▶' : '▧'}
          </span>
        )}
      </div>
      <div className="canvas-node-meta">
        <span>
          {sku ?? (kind === 'case' ? '案例' : '素材')}
          {file_version ? ` · V${kind === 'result' ? source_version : file_version}` : ''}
        </span>
        <span>{statusLabel[status] ?? status}</span>
      </div>
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
