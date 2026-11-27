import { draftWrite, type Draft, type ReferenceUsage } from '../creation/api';
import type { Canvas, CanvasNode } from './api';
import { projectEdges, referenceIssue } from './graph';

export function referenceCandidates(canvas: Canvas, draft: Draft) {
  const edges = projectEdges(canvas);
  return canvas.nodes.filter((node) => node.kind !== 'creation' && !referenceIssue(node, draft, edges));
}

export function attachCanvasReference(
  draft: Draft,
  token: string,
  source: CanvasNode,
  usage: ReferenceUsage,
) {
  return draftWrite(draft, token, '/references', {
    kind: source.kind,
    source_id: source.source_id,
    usage,
    file_version: source.file_version,
    source_version: source.source_version,
  });
}
