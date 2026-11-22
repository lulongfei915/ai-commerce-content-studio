import { ApartmentOutlined } from '@ant-design/icons';
import { useReactFlow } from '@xyflow/react';

import { actionError } from '../creation/api';
import type { Task } from '../tasks/api';
import type { Canvas, Positions, Viewport } from './api';
import type { SaveQueue } from './CanvasPage';
import { SaveNotice } from './CanvasTools';
import type { FlowNode } from './graph';

export function CanvasHeader({
  products,
  sku,
  count,
  layout,
  viewport,
  reload,
  onSku,
  onError,
}: {
  products: Task['products'];
  sku: string;
  count: number;
  layout: SaveQueue<Positions>;
  viewport: SaveQueue<Viewport>;
  reload: () => Promise<Canvas>;
  onSku: (sku: string) => void;
  onError: (message: string) => void;
}) {
  const flow = useReactFlow<FlowNode>();
  return (
    <header className="canvas-top">
      <strong className="canvas-title">
        <ApartmentOutlined aria-hidden="true" /> 自由画布
      </strong>
      <label>
        商品{' '}
        <select aria-label="画布 SKU" value={sku} onChange={(event) => onSku(event.target.value)}>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.sku}
            </option>
          ))}
          <option value="">全部 SKU</option>
        </select>
      </label>
      <span className="canvas-count">{count} 个节点</span>
      <div className="canvas-saves">
        <SaveNotice
          title="布局"
          state={layout.state}
          retry={() => void layout.retry()}
          reload={() => {
            void reload()
              .then((next) => layout.reset(next.layout.positions ?? [], next.layout.version ?? 0))
              .catch((cause: unknown) => onError(actionError(cause)));
          }}
        />
        <SaveNotice
          title="视口"
          state={viewport.state}
          retry={() => void viewport.retry()}
          reload={() => {
            void reload()
              .then((next) => {
                const { version, ...view } = next.viewport ?? { x: 0, y: 0, zoom: 1, version: 0 };
                viewport.reset(view, version);
                void flow.setViewport(view);
              })
              .catch((cause: unknown) => onError(actionError(cause)));
          }}
        />
      </div>
    </header>
  );
}
