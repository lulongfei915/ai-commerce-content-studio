import {
  AimOutlined,
  ApartmentOutlined,
  CompressOutlined,
  DragOutlined,
  ExpandOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  MinusOutlined,
  PlusOutlined,
  SelectOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';

import type { ReactNode } from 'react';
import type { SaveState } from './useVersionedSave';

export type AddKind = 'photos' | 'image' | 'video' | 'cases' | 'upload';

const Icon = {
  photos: FolderOpenOutlined,
  image: FileImageOutlined,
  video: VideoCameraOutlined,
  cases: ApartmentOutlined,
  upload: UploadOutlined,
};
const labels = {
  photos: '添加商品素材',
  image: '图片生成',
  video: '视频生成',
  cases: '加入案例',
  upload: '上传素材',
};

export function AddChoices({
  start,
  onChoose,
}: {
  start?: boolean;
  onChoose: (kind: AddKind) => void;
}) {
  const options: AddKind[] = start
    ? ['photos', 'image', 'video']
    : ['photos', 'image', 'video', 'cases', 'upload'];
  return (
    <div
      className={start ? 'canvas-start' : 'canvas-add-menu'}
      aria-label={start ? '开始创作' : '添加节点'}
    >
      {options.map((kind) => {
        const Symbol = Icon[kind];
        return (
          <button type="button" key={kind} onClick={() => onChoose(kind)}>
            <Symbol aria-hidden="true" />
            {labels[kind]}
          </button>
        );
      })}
    </div>
  );
}

export function ToolButton({
  label,
  children,
  onClick,
  disabled,
  pressed,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
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

export function CanvasTools({
  editable,
  moving,
  selected,
  relations,
  opened,
  onAdd,
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
          <ToolButton label="添加节点" pressed={opened} onClick={onAdd}>
            <PlusOutlined />
          </ToolButton>
        )}
        <ToolButton label="选择节点" pressed={!moving} onClick={onSelect}>
          <SelectOutlined />
        </ToolButton>
        <ToolButton label="移动画布" pressed={moving} onClick={onMove}>
          <DragOutlined />
        </ToolButton>
        {editable && (
          <ToolButton label="整理节点" onClick={onArrange}>
            <CompressOutlined />
          </ToolButton>
        )}
        <ToolButton
          label="仅显示选中关系"
          pressed={relations}
          disabled={!selected}
          onClick={onRelations}
        >
          <ApartmentOutlined />
        </ToolButton>
      </div>
      <div className="canvas-tool-group" aria-label="视口工具">
        <ToolButton label="缩小" onClick={() => onCamera('out')}>
          <MinusOutlined />
        </ToolButton>
        <ToolButton label="放大" onClick={() => onCamera('in')}>
          <PlusOutlined />
        </ToolButton>
        <ToolButton label="适应全部" onClick={() => onCamera('fit')}>
          <ExpandOutlined />
        </ToolButton>
        <ToolButton label="定位选中节点" disabled={!selected} onClick={() => onCamera('focus')}>
          <AimOutlined />
        </ToolButton>
      </div>
    </div>
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
