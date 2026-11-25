import { createPortal } from 'react-dom';
import { useContext, useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { ModalContainer } from './ModalContainer';

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
};

export function Modal({ title, children, onClose, busy = false, className = '' }: Props) {
  const container = useContext(ModalContainer);
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  const bounds = container?.getBoundingClientRect();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className={`studio-dialog ${className}${container ? ' studio-dialog-in-canvas' : ''}`}
      style={
        bounds
          ? {
              top: bounds.top,
              left: bounds.left,
              width: `min(660px, ${bounds.width - 20}px)`,
              maxHeight: `${bounds.height - 20}px`,
              margin: 0,
              translate: `${Math.max(10, (bounds.width - 660) / 2)}px 10px`,
            }
          : undefined
      }
      aria-labelledby={label}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header className="work-row">
        <h2 id={label}>{title}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>
      {children}
    </dialog>,
    container ?? document.body,
  );
}
