import { CloseOutlined } from '@ant-design/icons';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { ModalContainer } from '../../shared/ui/ModalContainer';

export function CanvasPanel({
  title,
  children,
  onClose,
  stage,
  anchor,
  busy,
  editor,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  stage: HTMLElement;
  anchor?: HTMLElement | null;
  busy: boolean;
  editor: boolean;
}) {
  const label = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 480 });
  useLayoutEffect(() => {
    function place() {
      const bounds = stage.getBoundingClientRect();
      const node = anchor?.getBoundingClientRect();
      const preferredWidth = Math.min(editor ? 600 : 480, bounds.width - 24);
      const nodeLeft = (node?.left ?? bounds.left) - bounds.left;
      const nodeTop = (node?.top ?? bounds.top) - bounds.top;
      const below = (node?.bottom ?? bounds.top) - bounds.top + 12;
      const right = nodeLeft + (node?.width ?? 0) + 12;
      const minHeight = editor ? 320 : 220;
      const fitsBelow = below + minHeight <= bounds.height - 12;
      const leftSpace = nodeLeft - 24;
      const rightSpace = bounds.width - right - 12;
      const sideWidth = Math.min(preferredWidth, Math.max(leftSpace, rightSpace));
      const useSide = node && !fitsBelow && sideWidth >= (editor ? 375 : 280);
      const width = useSide ? sideWidth : preferredWidth;
      const maxLeft = bounds.width - width - 12;
      const center = node ? nodeLeft + (node.width - width) / 2 : (bounds.width - width) / 2;
      const x = useSide ? (rightSpace >= leftSpace ? right : nodeLeft - width - 12) : center;
      const y = node && fitsBelow ? below : useSide ? nodeTop : 12;
      setPosition({
        left: Math.max(12, Math.min(maxLeft, x)),
        top: Math.max(12, Math.min(bounds.height - minHeight - 12, y)),
        width,
      });
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(stage);
    if (anchor) observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchor, editor, stage]);
  useLayoutEffect(() => {
    const origin = anchor ?? (document.activeElement as HTMLElement | null);
    close.current?.focus({ preventScroll: true });
    return () => {
      requestAnimationFrame(() => {
        if (origin?.isConnected && !stage.querySelector('.canvas-panel')) {
          origin.focus({ preventScroll: true });
        }
      });
    };
  }, [anchor, stage]);
  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || stage.querySelector('dialog[open]')) return;
      event.stopPropagation();
      event.preventDefault();
      if (!busy) onClose();
    }
    document.addEventListener('keydown', onEscape, true);
    return () => document.removeEventListener('keydown', onEscape, true);
  }, [busy, onClose, stage]);
  const style = {
    '--panel-left': `${position.left}px`,
    '--panel-top': `${position.top}px`,
    '--panel-width': `${position.width}px`,
  } as CSSProperties;
  return (
    <div
      className="canvas-scrim"
      onPointerDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={label}
        style={style}
        className={`canvas-panel${editor ? ' canvas-panel-editor' : ''} nodrag nopan nowheel`}
        onKeyDown={(event) => {
          if (event.target instanceof HTMLElement && !panel.current?.contains(event.target)) return;
          if (event.key !== 'Tab' || !panel.current) return;
          const items = Array.from(
            panel.current.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            ),
          ).filter((item) => item.getClientRects().length > 0);
          const first = items[0];
          const last = items.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="canvas-panel-header">
          <h3 id={label}>{title}</h3>
          <button
            ref={close}
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭画布浮层"
            title="关闭"
          >
            <CloseOutlined />
          </button>
        </header>
        <div className="canvas-panel-content">
          <ModalContainer.Provider value={stage}>{children}</ModalContainer.Provider>
        </div>
      </section>
    </div>
  );
}
