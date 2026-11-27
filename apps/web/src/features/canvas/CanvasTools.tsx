import {
  AimOutlined,
  ApartmentOutlined,
  CloseOutlined,
  CompressOutlined,
  DragOutlined,
  ExpandOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  MinusOutlined,
  PlusOutlined,
  PictureOutlined,
  SelectOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useViewport } from '@xyflow/react';
import type { XYPosition } from '@xyflow/react';
import { Tooltip } from 'antd';

import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import type { SaveState } from './useVersionedSave';

export type AddKind = 'photos' | 'image' | 'video' | 'cases' | 'upload' | 'results';

const Icon = {
  photos: FolderOpenOutlined,
  image: FileImageOutlined,
  video: VideoCameraOutlined,
  cases: ApartmentOutlined,
  upload: UploadOutlined,
  results: PictureOutlined,
};
const labels = {
  photos: '添加商品素材',
  image: '图片生成',
  video: '视频生成',
  cases: '加入案例',
  upload: '上传素材',
  results: '任务作品',
};

export function AddChoices({
  start,
  point,
  onChoose,
}: {
  start?: boolean;
  point?: XYPosition;
  onChoose: (kind: AddKind) => void;
}) {
  function option(kind: AddKind) {
    const Symbol = Icon[kind];
    return (
      <button type="button" key={kind} onClick={() => onChoose(kind)}>
        <Symbol aria-hidden="true" />
        {labels[kind]}
      </button>
    );
  }
  if (start) {
    return (
      <div className="canvas-start" role="group" aria-label="开始创作">
        <div className="canvas-start-hint">
          <AimOutlined aria-hidden="true" />
          <span>双击画布，添加节点</span>
        </div>
        <div className="canvas-start-choices">
          {(['photos', 'image', 'video'] as const).map(option)}
        </div>
      </div>
    );
  }
  return (
    <div
      className={`canvas-add-menu${point ? ' canvas-add-menu-at-point' : ''}`}
      role="group"
      aria-label="添加节点"
      style={point && ({ '--menu-x': `${point.x}px`, '--menu-y': `${point.y}px` } as CSSProperties)}
    >
      <div className="canvas-menu-group">
        <span>新建节点</span>
        {option('image')}
        {option('video')}
      </div>
      <div className="canvas-menu-group">
        <span>添加素材</span>
        {option('photos')}
        {option('cases')}
        {option('upload')}
      </div>
    </div>
  );
}

export function ToolButton({
  label,
  children,
  onClick,
  disabled,
  pressed,
  tooltip,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  tooltip?: boolean;
}) {
  return (
    <button
      type="button"
      title={tooltip ? undefined : label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className="canvas-tool-button"
    >
      {children}
    </button>
  );
}

function DockButton(props: ComponentProps<typeof ToolButton>) {
  return (
    <Tooltip
      title={props.label}
      placement="top"
      trigger={['hover', 'focus']}
      mouseEnterDelay={0.2}
      align={{ overflow: { shiftX: true, shiftY: true, adjustY: true } }}
      color="#303030"
    >
      <span className="canvas-tool-trigger">
        <ToolButton {...props} tooltip />
      </span>
    </Tooltip>
  );
}

export function CanvasTools({
  editable,
  moving,
  selected,
  relations,
  opened,
  onAdd,
  onResults,
  onMove,
  onRelations,
  onSelect,
  onArrange,
  onCamera,
}: {
  editable: boolean;
  moving: boolean;
  selected: boolean;
  relations: boolean;
  opened: boolean;
  onAdd: () => void;
  onResults: () => void;
  onMove: () => void;
  onRelations: () => void;
  onSelect: () => void;
  onArrange: () => void;
  onCamera: (action: 'in' | 'out' | 'fit' | 'focus') => void;
}) {
  return (
    <div className="canvas-tools">
      <div className="canvas-tool-group" aria-label="画布工具">
        {editable && (
          <DockButton label="添加节点" pressed={opened} onClick={onAdd}>
            {opened ? <CloseOutlined /> : <PlusOutlined />}
          </DockButton>
        )}
        <DockButton label="任务作品" onClick={onResults}>
          <PictureOutlined />
        </DockButton>
        <DockButton label="选择节点" pressed={!moving} onClick={onSelect}>
          <SelectOutlined />
        </DockButton>
        <DockButton label="移动画布" pressed={moving} onClick={onMove}>
          <DragOutlined />
        </DockButton>
        {editable && (
          <DockButton label="整理节点" onClick={onArrange}>
            <CompressOutlined />
          </DockButton>
        )}
        <DockButton
          label="仅显示选中关系"
          pressed={relations}
          disabled={!selected}
          onClick={onRelations}
        >
          <ApartmentOutlined />
        </DockButton>
      </div>
      <div className="canvas-tool-group" aria-label="视口工具">
        <DockButton label="缩小" onClick={() => onCamera('out')}>
          <MinusOutlined />
        </DockButton>
        <ZoomReadout />
        <DockButton label="放大" onClick={() => onCamera('in')}>
          <PlusOutlined />
        </DockButton>
        <DockButton label="适应全部" onClick={() => onCamera('fit')}>
          <ExpandOutlined />
        </DockButton>
        <DockButton label="定位选中节点" disabled={!selected} onClick={() => onCamera('focus')}>
          <AimOutlined />
        </DockButton>
      </div>
    </div>
  );
}

function ZoomReadout() {
  const { zoom } = useViewport();
  return (
    <span className="canvas-zoom" aria-label="缩放倍率">
      {Math.round(zoom * 100)}%
    </span>
  );
}

export function SaveNotice({
  title,
  state,
  retry,
  reload,
}: {
  title: string;
  state: SaveState;
  retry: () => void;
  reload: () => void;
}) {
  return (
    <span className={`canvas-save canvas-save-${state}`} role="status">
      {title}
      {state === 'saved'
        ? '已保存'
        : state === 'saving'
          ? '保存中'
          : state === 'conflict'
            ? '版本冲突'
            : '未保存'}
      {state === 'error' && (
        <button type="button" onClick={retry}>
          重试
        </button>
      )}
      {state === 'conflict' && (
        <button type="button" onClick={reload}>
          载入服务器版本
        </button>
      )}
    </span>
  );
}
