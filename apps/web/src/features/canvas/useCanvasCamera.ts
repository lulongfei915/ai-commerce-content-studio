import type { ReactFlowInstance } from '@xyflow/react';
import { useEffect, useRef } from 'react';

import type { Viewport } from './api';
import type { FlowNode } from './graph';

export function useCanvasCamera(
  flow: ReactFlowInstance<FlowNode>,
  focused: string,
  save: (view: Viewport) => void,
) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return async (action: 'in' | 'out' | 'fit' | 'focus', id = focused) => {
    const options = { duration: 160 };
    if (action === 'in') await flow.zoomIn(options);
    else if (action === 'out') await flow.zoomOut(options);
    else if (action === 'fit') await flow.fitView({ ...options, padding: 0.16 });
    else await flow.fitView({ ...options, nodes: [{ id }], padding: 0.45, maxZoom: 1.1 });
    if (mounted.current) save(flow.getViewport());
  };
}
