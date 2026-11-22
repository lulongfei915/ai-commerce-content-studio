import { CloseOutlined } from '@ant-design/icons';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { ModalContainer } from '../../shared/ui/ModalContainer';

export function CanvasPanel({
  title,
  children,
  onClose,
  stage,
  anchor,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  stage: HTMLElement;
  anchor?: HTMLElement | null;
  busy: boolean;
}) {
  const label = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
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
  const bounds = stage.getBoundingClientRect();
  const node = anchor?.getBoundingClientRect();
  const width = Math.min(555, bounds.width - 20);
  const preferredLeft = node ? node.right - bounds.left + 12 : bounds.width - width - 10;
  const alternateLeft = node ? node.left - bounds.left - width - 12 : 10;
  const left = Math.max(
    10,
    Math.min(
      preferredLeft + width <= bounds.width - 10 ? preferredLeft : alternateLeft,
      bounds.width - width - 10,
    ),
  );
  const top = node ? Math.max(10, Math.min(node.top - bounds.top, bounds.height - 310)) : 10;
  const style = { '--panel-left': `${left}px`, '--panel-top': `${top}px` } as CSSProperties;
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
        className="canvas-panel nodrag nopan nowheel"
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
