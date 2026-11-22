import {
  Background,
  NodeToolbar,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import type { Connection, XYPosition } from '@xyflow/react';
import { EyeOutlined, LinkOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import '@xyflow/react/dist/style.css';

import { actionError, removeReference } from '../creation/api';
import type { Draft } from '../creation/api';
import type { CanvasProps, SaveQueue } from './CanvasPage';
import { CanvasHeader } from './CanvasHeader';
import { CanvasPanelContent } from './CanvasPanelContent';
import { AddChoices, CanvasTools, ToolButton } from './CanvasTools';
import type { AddKind } from './CanvasTools';
import { nodePreview } from './api';
import type { Canvas, CanvasNode, Positions, Viewport } from './api';
import {
  defaultPositions,
  freePosition,
  movePositions,
  projectEdges,
  referenceIssue,
} from './graph';
import type { FlowNode } from './graph';
import { MediaNode } from './MediaNode';
import { useCanvasCamera } from './useCanvasCamera';

const nodeTypes = { studio: MediaNode };

type BoardProps = CanvasProps & {
  canvas: Canvas;
  layout: SaveQueue<Positions>;
  viewport: SaveQueue<Viewport>;
  reload: () => Promise<Canvas>;
};

export type PanelState =
  | { kind: AddKind; position?: XYPosition }
  | { kind: 'edit' | 'preview'; id: string }
  | { kind: 'connect'; source: string; target: string };

export function CanvasBoard(props: BoardProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

function Board(props: BoardProps) {
  const {
    canvas,
    task,
    session,
    layout,
    viewport,
    active,
    busy,
    reload,
    onSelect,
    onSaved,
    onBusy,
  } = props;
  const flow = useReactFlow<FlowNode>();
  const stage = useRef<HTMLDivElement>(null);
  const background = useRef<HTMLDivElement>(null);
  const [sku, setSku] = useState(
    () =>
      props.drafts.find((draft) => draft.id === active)?.product_id ?? task.products[0]?.id ?? '',
  );
  const [focused, setFocused] = useState(active ? `creation:${active}` : '');
  const [selectedEdge, setSelectedEdge] = useState('');
  const [relations, setRelations] = useState(false);
  const [moving, setMoving] = useState(false);
  const [menu, setMenu] = useState<{ position?: XYPosition; screen?: XYPosition }>();
  const [linking, setLinking] = useState('');
  const [panel, setPanel] = useState<PanelState>();
  const [error, setError] = useState('');
  const editable = session.permissions.includes('create');
  const token = session.csrf_token;
  const edges = useMemo(() => projectEdges(canvas), [canvas]);
  const byId = useMemo(() => new Map(canvas.nodes.map((node) => [node.id, node])), [canvas.nodes]);
  const related = useMemo(
    () =>
      new Set([
        focused,
        ...edges.flatMap((edge) =>
          edge.source === focused ? [edge.target] : edge.target === focused ? [edge.source] : [],
        ),
      ]),
    [edges, focused],
  );
  const positions = useMemo(
    () => new Map(layout.value.map((point) => [point.id, point])),
    [layout.value],
  );
  const modelNodes = useMemo(() => {
    const defaults = defaultPositions(canvas.nodes);
    const products = new Map(task.products.map((product) => [product.id, product.sku]));
    return canvas.nodes.map((node): FlowNode => ({
      id: node.id,
      type: 'studio',
      position: positions.get(node.id) ?? defaults[node.id],
      ariaLabel: `${node.label}${node.product_id ? ` · ${products.get(node.product_id) ?? ''}` : ''}`,
      data: {
        ...node,
        sku: products.get(node.product_id ?? ''),
        preview:
          node.previewable && node.file_version && node.media === 'image'
            ? nodePreview(task.id, node.id, node.file_version, node.source_version ?? undefined)
            : undefined,
      },
    }));
  }, [canvas.nodes, positions, task.id, task.products]);
  const [nodes, setNodes, onNodesChange] = useNodesState(modelNodes);
  useEffect(() => setNodes(modelNodes), [modelNodes, setNodes]);
  useEffect(() => {
    if (background.current) background.current.inert = Boolean(panel);
  }, [panel]);
  useEffect(() => {
    if (!menu) return;
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(undefined);
    }
    document.addEventListener('keydown', dismiss);
    return () => document.removeEventListener('keydown', dismiss);
  }, [menu]);

  const visibleNodes = useMemo(
    () =>
      nodes.map((node) => {
        const hidden = Boolean(
          (sku && node.data.product_id && node.data.product_id !== sku) ||
          (relations && focused && !related.has(node.id)),
        );
        const className =
          node.id === focused
            ? 'canvas-focused'
            : focused && !related.has(node.id)
              ? 'canvas-dim'
              : '';
        return { ...node, hidden, className };
      }),
    [nodes, sku, relations, focused, related],
  );
  const visibleIds = useMemo(
    () => new Set(visibleNodes.filter((node) => !node.hidden).map((node) => node.id)),
    [visibleNodes],
  );
  const visibleEdges = useMemo(
    () =>
      edges
        .filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
        .map((edge) => {
          const highlighted =
            edge.id === selectedEdge ||
            Boolean(focused && [edge.source, edge.target].includes(focused));
          return {
            ...edge,
            className: `${edge.className ?? ''}${highlighted ? ' canvas-edge-active' : focused ? ' canvas-dim' : ''}`,
          };
        }),
    [edges, focused, selectedEdge, visibleIds],
  );
  const focusedNode = byId.get(focused);
  const accepted = new Set(canvas.nodes.map((node) => node.id));
  const connect = useCallback(
    (sourceId: string, targetId: string) => {
      const source = byId.get(sourceId);
      const target = props.drafts.find((draft) => `creation:${draft.id}` === targetId);
      if (!editable || busy || !source || !target) return;
      const message = referenceIssue(source, target, edges);
      setError(message);
      if (!message) setPanel({ kind: 'connect', source: sourceId, target: targetId });
    },
    [byId, busy, editable, edges, props.drafts],
  );

  const saveCamera = viewport.save;

  const camera = useCanvasCamera(flow, focused, saveCamera);

  function open(node: CanvasNode) {
    if (node.kind === 'creation' && !editable) return;
    if (node.kind === 'creation') onSelect(node.source_id);
    setPanel({ kind: node.kind === 'creation' ? 'edit' : 'preview', id: node.id });
  }

  function selectNode(event: MouseEvent, node: FlowNode) {
    setMenu(undefined);
    if (moving) return;
    setSelectedEdge('');
    setFocused(node.id);
    if (event.currentTarget instanceof HTMLElement)
      event.currentTarget.focus({ preventScroll: true });
    if (linking && node.data.kind === 'creation') connect(linking, node.id);
    else if (node.data.kind === 'creation') onSelect(node.data.source_id);
  }

  function addPosition(id: string, requested?: XYPosition) {
    if (positions.has(id)) return;
    const bounds = stage.current?.getBoundingClientRect();
    const center = bounds
      ? flow.screenToFlowPosition({
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        })
      : { x: 100, y: 70 };
    const initialPosition = id.startsWith('creation:')
      ? {
          x: center.x + (nodes.length && bounds && bounds.width > 700 ? 120 : -100),
          y: center.y - 135,
        }
      : { x: center.x - 100, y: center.y - 70 };
    const next = freePosition(requested ?? initialPosition, nodes);
    layout.save(movePositions(layout.value, [{ id, ...next }]));
    setFocused(id);
  }

  async function refreshAfter(draft?: Draft) {
    if (draft) onSaved(draft);
    try {
      await reload();
    } catch (cause) {
      setError(actionError(cause));
    }
  }

  function clearPanel() {
    setPanel(undefined);
    setLinking('');
  }

  const selectedReference = canvas.edges.find((edge) => edge.id === selectedEdge);
  const edgeDraft = props.drafts.find(
    (draft) => `creation:${draft.id}` === selectedReference?.target,
  );
  const canRemoveEdge = edgeDraft?.references.some(
    (ref) => ref.id === selectedEdge && ref.origin === 'independent',
  );
  const canRemoveNode =
    focusedNode &&
    ['case', 'upload'].includes(focusedNode.kind) &&
    positions.has(focused) &&
    !canvas.edges.some((edge) => edge.source === focused);
  const anchorId =
    panel && ('id' in panel ? panel.id : panel.kind === 'connect' ? panel.target : '');
  const anchor = anchorId
    ? stage.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(anchorId)}"]`,
      )
    : undefined;

  return (
    <section className="canvas-shell" aria-label="制作画布">
      <CanvasHeader
        products={task.products}
        sku={sku}
        count={visibleIds.size}
        layout={layout}
        viewport={viewport}
        reload={reload}
        onError={setError}
        onSku={(next) => {
          setSku(next);
          setFocused('');
          setLinking('');
          setRelations(false);
          requestAnimationFrame(() => void camera('fit'));
        }}
      />
      <div
        className="canvas-stage"
        ref={stage}
        onDoubleClick={(event) => {
          if (
            !editable ||
            moving ||
            panel ||
            !(event.target instanceof HTMLElement) ||
            !event.target.classList.contains('react-flow__pane')
          )
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = { x: event.clientX, y: event.clientY };
          setMenu({
            position: flow.screenToFlowPosition(point),
            screen: { x: point.x - bounds.left, y: point.y - bounds.top },
          });
        }}
      >
        <div ref={background} className="canvas-background">
          <ReactFlow<FlowNode>
            nodes={visibleNodes}
            edges={visibleEdges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={selectNode}
            onNodeDoubleClick={(_event, node) => {
              if (!moving) open(node.data);
            }}
            onNodeDragStop={(_event, _node, dragged) => {
              layout.save(
                movePositions(
                  layout.value.filter((point) => accepted.has(point.id)),
                  dragged.map((node) => ({ id: node.id, ...node.position })),
                ),
              );
            }}
            onConnect={(connection: Connection) => connect(connection.source, connection.target)}
            onMoveEnd={(event, next) => {
              if (event) saveCamera(next);
            }}
            onEdgeClick={(_event, edge) => {
              setFocused('');
              setSelectedEdge(edge.id);
              setRelations(false);
            }}
            onPaneClick={() => {
              setFocused('');
              setSelectedEdge('');
              setRelations(false);
              setMenu(undefined);
            }}
            nodesDraggable={editable && !moving && !busy}
            nodesConnectable={editable && !moving && !busy}
            elementsSelectable={!moving}
            panOnDrag={moving ? true : [1, 2]}
            selectionOnDrag={!moving}
            selectionMode={SelectionMode.Partial}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            minZoom={0.1}
            maxZoom={2}
            defaultViewport={viewport.value}
            fitView={!canvas.viewport && viewport.value.x === 0 && viewport.value.y === 0}
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            colorMode="dark"
            aria-label="节点画布"
          >
            <Background gap={22} size={1.5} color="#44464a" />
            {focusedNode && visibleIds.has(focused) && !menu && (
              <NodeToolbar
                nodeId={focused}
                isVisible
                position={Position.Top}
                offset={9}
                className="canvas-context"
                aria-label="节点操作"
              >
                <span>{focusedNode.label}</span>
                {(focusedNode.kind !== 'creation' || editable) && (
                  <ToolButton
                    label={focusedNode.kind === 'creation' ? '编辑节点' : '预览节点'}
                    onClick={() => open(focusedNode)}
                  >
                    {focusedNode.kind === 'creation' ? <EditOutlined /> : <EyeOutlined />}
                  </ToolButton>
                )}
                {editable && focusedNode.kind !== 'creation' && (
                  <ToolButton
                    label="引用节点"
                    disabled={!focusedNode.referenceable || busy}
                    onClick={() => {
                      setLinking(focused);
                      setError('');
                    }}
                  >
                    <LinkOutlined />
                  </ToolButton>
                )}
                {editable && linking && focusedNode.kind === 'creation' && (
                  <ToolButton label="输入引用" onClick={() => connect(linking, focused)}>
                    <LinkOutlined />
                  </ToolButton>
                )}
                {editable && canRemoveNode && (
                  <ToolButton
                    label="移除素材节点"
                    onClick={() => {
                      if (window.confirm('从画布移除此素材？')) {
                        layout.save(
                          layout.value.filter(
                            (point) => point.id !== focused && accepted.has(point.id),
                          ),
                        );
                        setFocused('');
                      }
                    }}
                  >
                    <DeleteOutlined />
                  </ToolButton>
                )}
              </NodeToolbar>
            )}
          </ReactFlow>
          {!visibleIds.size && !menu && editable && (
            <AddChoices start onChoose={(kind) => setPanel({ kind })} />
          )}
          {!visibleIds.size && !editable && <p className="canvas-empty">当前没有节点</p>}
          {menu && (
            <AddChoices
              point={menu.screen}
              onChoose={(kind) => {
                setPanel({ kind, position: menu.position });
                setMenu(undefined);
              }}
            />
          )}
          {editable && edgeDraft && canRemoveEdge && (
            <div className="canvas-edge-context">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('移除这条输入引用？')) return;
                  onBusy(true);
                  void removeReference(edgeDraft, token, selectedEdge)
                    .then((draft) => {
                      setSelectedEdge('');
                      return refreshAfter(draft);
                    })
                    .catch((cause: unknown) => setError(actionError(cause)))
                    .finally(() => onBusy(false));
                }}
              >
                移除连线
              </button>
            </div>
          )}
          {linking && (
            <div className="canvas-link-status" role="status">
              选择目标生成节点{' '}
              <button type="button" onClick={() => setLinking('')}>
                取消
              </button>
            </div>
          )}
          {relations && <span className="canvas-filter-status">仅显示选中关系</span>}
          {error && (
            <p role="alert" className="canvas-error work-error">
              {error}
            </p>
          )}
          <CanvasTools
            editable={editable}
            moving={moving}
            selected={Boolean(focused)}
            relations={relations}
            opened={Boolean(menu)}
            onAdd={() => setMenu(menu ? undefined : {})}
            onMove={() => setMoving(true)}
            onSelect={() => setMoving(false)}
            onRelations={() => setRelations(!relations)}
            onCamera={(action) => void camera(action)}
            onArrange={() => {
              const arranged = defaultPositions(canvas.nodes);
              layout.save(Object.entries(arranged).map(([id, point]) => ({ id, ...point })));
              requestAnimationFrame(() => void camera('fit'));
            }}
          />
        </div>
        {panel && stage.current && (
          <CanvasPanelContent
            key={panel.kind}
            {...props}
            panel={panel}
            stage={stage.current}
            anchor={anchor}
            sku={sku}
            addPosition={addPosition}
            onClose={clearPanel}
            onRefresh={refreshAfter}
            onLocate={(id) => {
              setFocused(id);
              setSku('');
              clearPanel();
              requestAnimationFrame(() => void camera('focus', id));
            }}
            onActivate={(draft) => {
              setFocused(`creation:${draft.id}`);
              setSku(draft.product_id);
              setPanel({ kind: 'edit', id: `creation:${draft.id}` });
            }}
          />
        )}
      </div>
    </section>
  );
}
