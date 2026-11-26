import { useId, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowLeftOutlined, CloseOutlined } from '@ant-design/icons';

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
  subtitle?: string;
  busy: boolean;
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  const wide = useSyncExternalStore(subscribe, wideScreen);
  const { title, subtitle, busy, onClose, onBack, children } = props;
  const heading = useId();
  const back = onBack && <button className="batch-plain batch-icon" type="button"
    disabled={busy} onClick={onBack} aria-label="返回" title="返回"><ArrowLeftOutlined /></button>;
  if (!wide) {
    return (
      <Modal title={title} onClose={onClose} busy={busy} className="batch-drawer" dismissOnBackdrop>
        <div className="batch-panel-body">
          {(onBack || subtitle) && <div className="batch-subview">
            {back}
            {subtitle && <strong>{subtitle}</strong>}
          </div>}
          {children}
        </div>
      </Modal>
    );
  }
  return (
    <aside className="batch-panel" aria-labelledby={heading}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy && event.target instanceof Node
          && event.currentTarget.contains(event.target)) {
          event.stopPropagation();
          onClose();
        }
      }}>
      <header>
        {back}
        <h3 id={heading} title={title}>{title}</h3>
        {subtitle && <small>{subtitle}</small>}
        <button className="batch-plain batch-icon" type="button" disabled={busy}
          onClick={onClose} aria-label="关闭" title="关闭">
          <CloseOutlined />
        </button>
      </header>
      <div className="batch-panel-body" key={subtitle}>{children}</div>
    </aside>
  );
}
