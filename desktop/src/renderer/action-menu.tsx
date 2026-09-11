import React, { useEffect, useId, useRef, useState } from 'react';

export type MenuAction = { label: string; icon?: React.ReactNode; action: () => void; disabled?: boolean; danger?: boolean; divider?: boolean };
export type MenuPoint = { x: number; y: number; target: HTMLElement };

/** Native popovers escape scrolling panels and provide outside-click/Escape dismissal. */
export function ActionMenu({ label, children, items, className = 'icon-button', point, onOpen }: {
  label: string; children: React.ReactNode; items: MenuAction[]; className?: string; point?: MenuPoint; onOpen?: () => void;
}) {
  const id = useId();
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  function position(x: number, y: number) {
    const element = menu.current!;
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - element.offsetHeight - 8))}px`;
  }
  function show(at?: MenuPoint) {
    const element = menu.current!;
    returnFocus.current = at?.target ?? trigger.current;
    element.showPopover();
    const bounds = trigger.current!.getBoundingClientRect();
    position(at?.x ?? Math.min(bounds.left, window.innerWidth - element.offsetWidth - 12), at?.y ?? bounds.bottom + 6);
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    onOpen?.();
  }
  function close(restore = true) {
    menu.current?.hidePopover();
    if (restore) returnFocus.current?.focus();
  }
  useEffect(() => {
    if (!point) return;
    // Let the contextmenu event finish its native popover dismissal before opening.
    const frame = requestAnimationFrame(() => show(point));
    return () => cancelAnimationFrame(frame);
  }, [point]);
  useEffect(() => {
    const hide = () => close(false);
    window.addEventListener('resize', hide);
    return () => window.removeEventListener('resize', hide);
  }, []);
  return <>
    <button ref={trigger} className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onClick={() => open ? close() : show()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(); }
      }}>{children}</button>
    <div ref={menu} id={id} className="action-menu" popover="auto" role="menu" aria-label={label}
      onToggle={event => setOpen(event.newState === 'open')} onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); close(); return; }
        if (event.key === 'Tab') { close(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}>
      {items.map(item => <React.Fragment key={item.label}>
        {item.divider && <hr role="separator" />}
        <button role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled} onClick={() => { close(); item.action(); }}>
          {item.icon}<span>{item.label}</span>
        </button>
      </React.Fragment>)}
    </div>
  </>;
}
