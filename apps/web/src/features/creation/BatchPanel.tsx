import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { Modal } from '../../shared/ui/Modal';

const desktop = '(min-width: 1100px)';
function subscribe(onChange: () => void) {
  const width = window.matchMedia(desktop);
  width.addEventListener('change', onChange);
  return () => width.removeEventListener('change', onChange);
}
function wideScreen() {
  return typeof window.matchMedia === 'function' && window.matchMedia(desktop).matches;
}

export function BatchPanel(props: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const wide = useSyncExternalStore(subscribe, wideScreen);
  return wide ? <InlinePanel {...props} /> : <Modal {...props} className="batch-drawer" />;
}

function InlinePanel({ title, busy, onClose, children }: Parameters<typeof BatchPanel>[0]) {
  const heading = useId();
  const closeButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const trigger = document.activeElement;
    closeButton.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return (
    <aside className="batch-panel" aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          event.stopPropagation();
          onClose();
        }
      }}>
      <header className="work-row">
        <h3 id={heading}>{title}</h3>
        <button ref={closeButton} type="button" disabled={busy} onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>
      {children}
    </aside>
  );
}
