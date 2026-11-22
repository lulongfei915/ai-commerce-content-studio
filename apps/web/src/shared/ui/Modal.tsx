import { createPortal } from 'react-dom';
import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

type Props = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
};

export function Modal({ title, children, onClose, busy = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const label = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);

  return createPortal(
    <dialog
      ref={ref}
      className="studio-dialog"
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
    document.body,
  );
}
