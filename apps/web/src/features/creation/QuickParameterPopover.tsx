import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { DownOutlined } from '@ant-design/icons';

import { isSelectPickerOpen } from '../../shared/ui/selectPicker';

export function QuickParameterPopover({
  label, value, open, disabled, width, onOpen, children, anchored = false, icon,
}: {
  label: string;
  value: string;
  open: boolean;
  disabled: boolean;
  width?: 'wide';
  anchored?: boolean;
  icon?: ReactNode;
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
      const flip = (anchored || below < popover.scrollHeight) && above > below;
      popover.dataset.above = String(flip);
      popover.style.maxHeight = `${Math.max(0, flip ? above : below)}px`;
      const left = Math.max(12, Math.min(bounds.left, document.documentElement.clientWidth - popover.offsetWidth - 12));
      popover.style.left = `${anchored ? left : left - bounds.left}px`;
      if (anchored) {
        popover.style.top = flip ? 'auto' : `${bounds.bottom + 6}px`;
        popover.style.bottom = flip ? `${window.innerHeight - bounds.top + 6}px` : 'auto';
      }
    }
    place();
    (popover.querySelector<HTMLElement>('button[aria-pressed="true"]:not(:disabled)')
      ?? popover.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)')
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
  }, [anchored, open]);

  function closeAndFocus() {
    onOpen(false);
    trigger.current?.focus();
  }

  return (
    <div className="quick-parameter-anchor" data-parameter-open={open || undefined} ref={anchor} onKeyDown={(event) => {
      if (event.key !== 'Escape' || !open || isSelectPickerOpen(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      closeAndFocus();
    }}>
      <button type="button" className="quick-parameter-trigger" ref={trigger}
        aria-label={`${label}，${value}`} aria-expanded={open}
        aria-controls={open ? id : undefined} disabled={disabled} onClick={() => onOpen(!open)}>
        {icon}{value} <DownOutlined aria-hidden="true" />
      </button>
      {open && (
        <div id={id} ref={panel} className="quick-parameter-popover" data-width={width}
          data-anchored={anchored || undefined}
          role="group" aria-label={label} tabIndex={-1}>
          {children(closeAndFocus)}
        </div>
      )}
    </div>
  );
}
