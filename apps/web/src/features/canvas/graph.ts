import type { Edge, Node, XYPosition } from '@xyflow/react';

import { usageLabel } from '../creation/api';
import type { Draft, ReferenceUsage } from '../creation/api';
import type { Canvas, CanvasNode, Positions } from './api';
import { nodePreview } from './api';
import { purposeLabel, type Task } from '../tasks/api';

export type FlowNode = Node<CanvasNode & { sku?: string; purpose?: string; preview?: string }, 'studio'>;

export function projectNodes(
  canvas: Canvas,
  positions: Map<string, XYPosition>,
  task: Task,
): FlowNode[] {
  const defaults = defaultPositions(canvas.nodes);
  const purposes = new Map(canvas.creations.map((draft) => [draft.id, purposeLabel[draft.purpose]]));
  const products = new Map(task.products.map((product) => [product.id, product.sku]));
  return canvas.nodes.map((node) => {
    const sku = products.get(node.product_id ?? '');
    return {
      id: node.id,
      type: 'studio',
      position: positions.get(node.id) ?? defaults[node.id],
      ariaLabel: sku ? `${node.label} · ${sku}` : node.label,
      data: {
        ...node,
        sku,
        purpose: node.kind === 'creation' ? purposes.get(node.source_id) : undefined,
        preview:
          node.previewable && node.file_version && node.media === 'image'
            ? nodePreview(task.id, node.id, node.file_version, node.source_version ?? undefined)
            : undefined,
      },
    };
  });
}

export function defaultPositions(nodes: CanvasNode[]): Record<string, XYPosition> {
  const positions: Record<string, XYPosition> = {};
  let inputs = 0;
  let drafts = 0;
  const results = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind === 'creation') {
      positions[node.id] = { x: 270 + (drafts % 3) * 275, y: Math.floor(drafts / 3) * 360 };
      drafts++;
    } else if (node.kind !== 'result') {
      positions[node.id] = { x: -Math.floor(inputs / 4) * 235, y: (inputs % 4) * 170 };
      inputs++;
    }
  }
  for (const node of nodes) {
    if (node.kind !== 'result') continue;
    const owner = node.source_creation_id ?? '';
    const parent = positions[`creation:${owner}`] ?? { x: 270, y: 0 };
    const index = results.get(owner) ?? 0;
    results.set(owner, index + 1);
    positions[node.id] = { x: parent.x + index * 235, y: parent.y + 175 };
  }
  return positions;
}

export function movePositions(current: Positions, updates: Positions): Positions {
  const next = new Map(current.map((point) => [point.id, point]));
  for (const point of updates) next.set(point.id, point);
  return [...next.values()];
}

export function freePosition(start: XYPosition, nodes: FlowNode[]): XYPosition {
  const next = { ...start };
  while (
    nodes.some(
      ({ position }) => Math.abs(position.x - next.x) < 205 && Math.abs(position.y - next.y) < 145,
    )
  ) {
    next.y += 155;
  }
  return next;
}

export function projectEdges(canvas: Canvas): Edge[] {
  return [
    ...canvas.edges.map((edge) => ({
      ...edge,
      label: usageLabel[edge.usage],
      sourceHandle: 'reference',
      targetHandle: 'input',
    })),
    ...canvas.nodes
      .filter((node) => node.kind === 'result' && node.source_creation_id)
      .map((node) => ({
        id: `output:${node.id}`,
        source: `creation:${node.source_creation_id}`,
        target: node.id,
        sourceHandle: 'output',
        targetHandle: 'origin',
        className: 'canvas-result-edge',
        selectable: false,
      })),
  ];
}

export function reachable(from: string, to: string, edges: Edge[]) {
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length) {
    const node = pending.pop()!;
    if (node === to) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const edge of edges) {
      if (edge.source === node) pending.push(edge.target);
    }
  }
  return false;
}

export function referenceIssue(source: CanvasNode, target: Draft, edges: Edge[]) {
  if (source.product_id && source.product_id !== target.product_id) return '该素材属于其他 SKU。';
  if (reachable(`creation:${target.id}`, source.id, edges)) return '该连接会形成循环依赖。';
  if (
    !source.referenceable ||
    (source.allowed_purposes && !source.allowed_purposes.includes(target.purpose))
  )
    return '该素材不可引用至当前用途。';
  if (source.media === 'video' && target.purpose !== 'video') return '图片生成不支持视频参考。';
  if (target.references.some((ref) => ref.file_id === source.file_id)) return '该文件已被引用。';
  return '';
}

export function allowedUsages(source: CanvasNode, draft: Draft): NonNullable<ReferenceUsage>[] {
  if (source.media === 'video') return ['expression'];
  return [
    ...(source.kind === 'upload' && source.product_id ? ['product' as const] : []),
    'expression',
    'composition',
    'lighting',
    ...(draft.purpose === 'video' ? ['first_frame' as const, 'last_frame' as const] : []),
  ];
}
