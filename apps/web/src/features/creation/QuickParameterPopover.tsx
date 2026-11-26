import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { DownOutlined } from '@ant-design/icons';

export function QuickParameterPopover({
  label, value, open, disabled, width, onOpen, children,
}: {
  label: string;
  value: string;
  open: boolean;
  disabled: boolean;
  width?: 'wide';
  onOpen: (open: boolean) => void;
  children: (selectAndClose: () => void) => ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const onClose = useRef(onOpen);
  onClose.current = onOpen;

  useLayoutEffect(() => {
    const button = trigger.current;
    const popover = panel.current;
    if (!open || !button || !popover) return;

    function place() {
      if (!button || !popover) return;
      const bounds = button.getBoundingClientRect();
      const below = window.innerHeight - bounds.bottom - 16;
      const above = bounds.top - 16;
      const flip = below < popover.scrollHeight && above > below;
      popover.dataset.above = String(flip);
      popover.style.maxHeight = `${Math.max(0, flip ? above : below)}px`;
      const left = Math.max(12, Math.min(bounds.left, document.documentElement.clientWidth - popover.offsetWidth - 12));
      popover.style.left = `${left - bounds.left}px`;
    }
    place();
    (popover.querySelector<HTMLElement>('button[aria-pressed="true"]:not(:disabled)')
      ?? popover.querySelector<HTMLElement>('button:not(:disabled)')
      ?? popover).focus({ preventScroll: true });

    function dismissOutside(event: Event) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target)) onClose.current(false);
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    observer?.observe(popover);
    observer?.observe(button);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('focusin', dismissOutside);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('focusin', dismissOutside);
    };
  }, [open]);

  function closeAndFocus() {
    onOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="quick-parameter-anchor" ref={anchor} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open) return;
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    }}>
      <button type="button" className="quick-parameter-trigger" ref={trigger}
        aria-label={`${label}，${value}`} aria-expanded={open}
        aria-controls={open ? id : undefined} disabled={disabled} onClick={() => onOpen(!open)}>
        {value} <DownOutlined aria-hidden="true" />
      </button>
      {open && (
        <div id={id} ref={panel} className="quick-parameter-popover" data-width={width}
          role="group" aria-label={label} tabIndex={-1}>
          {children(closeAndFocus)}
        </div>
      )}
    </div>
  );
}
