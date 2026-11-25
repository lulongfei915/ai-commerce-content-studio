import { useLayoutEffect, type RefObject } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { FlowNode } from './graph';

// Frame the preview and its screen-sized composer without writing an editing zoom to the layout.
export function useComposerCamera(
  flow: ReactFlowInstance<FlowNode>,
  stage: RefObject<HTMLElement>,
  id?: string,
) {
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !id) return;
    const anchorId = id;
    const original = flow.getViewport();
    let framed: typeof original | undefined;
    let raf = 0;
    function place() {
      const node = flow.getNode(anchorId);
      if (!node?.measured?.width || !node.measured.height) {
        raf = requestAnimationFrame(place);
        return;
      }
      const { width, height } = element!.getBoundingClientRect();
      const mobile = width <= 700;
      const reserved = mobile ? Math.min(height * 0.58, 350) : 320;
      const topBar = mobile ? 100 : 65;
      const room = Math.max(64, height - reserved - topBar - 55);
      const zoom = Math.min(
        1.95,
        (width * (mobile ? 0.62 : node.data.media === 'video' ? 0.23 : 0.29)) / node.measured.width,
        room / node.measured.height,
      );
      const nodeTop = topBar + (room - node.measured.height * zoom) / 2;
      framed = {
        zoom,
        x: width / 2 - (node.position.x + node.measured.width / 2) * zoom,
        y: nodeTop - node.position.y * zoom,
      };
      void flow.setViewport(framed);
    }
    raf = requestAnimationFrame(place);
    return () => {
      cancelAnimationFrame(raf);
      const current = flow.getViewport();
      if (
        framed &&
        current.x === framed.x &&
        current.y === framed.y &&
        current.zoom === framed.zoom
      ) {
        void flow.setViewport(original);
      }
    };
  }, [flow, stage, id]);
}
